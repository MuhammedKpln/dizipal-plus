// ==UserScript==
// @name         Televisorium Sync · Dizipal
// @namespace    televisorium.dizipal
// @version      2.4.0
// @description  Syncs watch progress, watchlist and ratings from dizipal* directly to your Nextcloud Televisorium (OCS) app. Removes site ads, video preroll and in-player casino overlays. Shows your latest watched episode on the home page. Works on desktop (Tampermonkey/Violentmonkey) and iOS (Userscripts).
// @author       dizipal-sync
// @match        http*://dizipal*.com/*
// @match        http*://*.dizipal*.com/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    var TVS = window.TVS = window.TVS || {};
    TVS.version = '2.4.0';

    var USE_GM = (typeof GM_getValue === 'function' && typeof GM_setValue === 'function');
    var LS_PREFIX = 'tvs:';
    var K_SETTINGS = 'settings';
    var K_LOG = 'log';
    var K_ITEM = 'itemCache';
    var K_RESUME = 'resume';
    var K_NOW = 'nowWatching';

    function lsGet(k) { try { return localStorage.getItem(LS_PREFIX + k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(LS_PREFIX + k, v); return true; } catch (e) { return false; } }

    TVS.storeGet = function (k, def) {
        if (USE_GM) {
            try {
                var v = GM_getValue(k);
                if (typeof v !== 'undefined' && v !== null && v !== '') {
                    try { return JSON.parse(v); } catch (e) { return v; }
                }
            } catch (e) { /* noop */ }
            return def;
        }
        var s = lsGet(k);
        if (s === null || s === '') return def;
        try { return JSON.parse(s); } catch (e) { return def; }
    };
    TVS.storeSet = function (k, v) {
        var s = JSON.stringify(v);
        if (USE_GM) { try { GM_setValue(k, s); return true; } catch (e) { /* noop */ } }
        return lsSet(k, s);
    };
    TVS.storeDel = function (k) {
        if (USE_GM) { try { GM_deleteValue(k); } catch (e) { /* noop */ } return; }
        try { localStorage.removeItem(LS_PREFIX + k); } catch (e) { /* noop */ }
    };

    function getSettings() {
        var s = TVS.storeGet(K_SETTINGS, {});
        s.ncUrl = String(s.ncUrl || '').replace(/\/+$/, '');
        return s;
    }
    function saveSettings(patch) {
        var s = getSettings();
        for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
        TVS.storeSet(K_SETTINGS, s);
    }

    function logPush(level, msg) {
        var l = TVS.storeGet(K_LOG, []);
        l.unshift({ ts: Date.now(), level: level, msg: msg });
        if (l.length > 60) l.length = 60;
        TVS.storeSet(K_LOG, l);
        if (level === 'error') console.error('[TVS] ' + msg); else console.log('[TVS] ' + msg);
    }
    TVS.getLog = function () { return TVS.storeGet(K_LOG, []); };
    TVS.clearLog = function () { TVS.storeDel(K_LOG); };

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function lower(s) { return String(s || '').toLowerCase(); }
    function normTitle(t) { return lower(t).replace(/['’]/g, '').replace(/[.!,":]/g, '').replace(/\s+/g, ' ').trim(); }

    function b64(str) {
        if (typeof btoa === 'function') {
            try { return btoa(unescape(encodeURIComponent(str))); } catch (e) { /* fallthrough */ }
        }
        var out = '';
        for (var i = 0; i < str.length; i++) out += String.fromCharCode(str.charCodeAt(i));
        return btoa(out);
    }

    TVS.pageType = function () {
        var p = location.pathname.replace(/\/+$/, '');
        if (!p) return 'home';
        var root = p.split('/')[1] || '';
        if (root === 'film') return 'movie';
        if (root === 'bolum') return 'episode';
        if (root === 'dizi') return 'series';
        return 'other';
    };

    function posterFromMethods() {
        var og = document.querySelector('meta[property="og:image"]');
        if (og) return og.getAttribute('content') || '';
        var fp = document.querySelector('.film-poster img');
        if (fp) return fp.getAttribute('src') || fp.getAttribute('data-src') || '';
        var sel = document.querySelector('.series-hero, .video-player-container .player-cover-overlay');
        if (sel) {
            var st = sel.getAttribute('style') || '';
            var m = st.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
            if (m) return m[1];
        }
        return '';
    }

    TVS.extractMeta = function () {
        var type = TVS.pageType();
        var meta = { pageType: type, itemType: null, id: '', title: '', year: '', season: null, episode: null, slug: '', posterUrl: '', url: location.pathname };
        var pc = document.getElementById('pageConfig');
        if (pc) meta.id = pc.getAttribute('data-view-id') || '';

        if (type === 'movie') {
            meta.itemType = 'movie';
            var fm = document.querySelector('.film-title') || document.querySelector('h1');
            if (fm) meta.title = fm.textContent.trim();
            var fy = document.querySelector('.film-year');
            if (fy) meta.year = (fy.textContent.match(/\d{4}/) || [''])[0];
            var wb = document.querySelector('.btn-watchlist');
            if (!meta.id && wb && wb.dataset.contentId) meta.id = wb.dataset.contentId;
        } else if (type === 'episode') {
            meta.itemType = 'tv';
            var ser = null;
            var reg = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
            var full = document.documentElement.outerHTML;
            var mm;
            while ((mm = reg.exec(full)) !== null) {
                try {
                    var j = JSON.parse(mm[1]);
                    var g = (j && j['@graph']) || (j ? [j] : []);
                    for (var k = 0; k < g.length; k++) {
                        if (g[k] && g[k]['@type'] === 'TVEpisode') { ser = g[k]; break; }
                    }
                } catch (e) { /* noop */ }
                if (ser) break;
            }
            var pm = location.pathname.match(/-(\d+)-sezon-(\d+)-bolum\/?$/);
            if (pm) {
                meta.season = parseInt(pm[1], 10);
                meta.episode = parseInt(pm[2], 10);
                var seg = location.pathname.split('/')[2] || '';
                meta.slug = seg.replace(/-\d+-sezon-\d+-bolum\/?$/, '');
            }
            if (!meta.season && ser && ser.partOfSeason) {
                meta.season = ser.partOfSeason.seasonNumber || null;
                meta.episode = ser.episodeNumber || null;
            }
            if (ser && ser.partOfSeries) meta.title = ser.partOfSeries.name || '';
            if (!meta.title && meta.slug) meta.title = meta.slug.replace(/-/g, ' ');
            if (!meta.title) {
                var st = document.querySelector('.series-title') || document.querySelector('h1');
                if (st) meta.title = st.textContent.trim().replace(/\s*\d+\.\s*Sezon\s*\d+\.\s*Bölüm$/i, '');
            }
            meta.year = '';
        } else if (type === 'series') {
            meta.itemType = 'tv';
            var st2 = document.querySelector('.series-title') || document.querySelector('h1');
            if (st2) meta.title = st2.textContent.trim();
            var wbs = document.querySelector('.btn-watchlist');
            if (!meta.id && wbs && wbs.dataset.contentId) meta.id = wbs.dataset.contentId;
        }
        meta.posterUrl = posterFromMethods();
        return meta;
    };

    function ncRequest(method, pathPart, data) {
        return new Promise(function (resolve, reject) {
            var s = getSettings();
            if (!s.ncUrl) return reject(new Error('Nextcloud adresi ayarlanmamış.'));
            if (!s.ncUser || !s.ncPass) return reject(new Error('Kullanıcı adı/parola eksik.'));
            var withFormat = pathPart + (pathPart.indexOf('?') === -1 ? '?' : '&') + 'format=json';
            var url = s.ncUrl + '/ocs/v2.php/apps/televisorium' + withFormat;
            var headers = {
                'OCS-APIRequest': 'true',
                'Accept': 'application/json',
                'Authorization': 'Basic ' + b64(s.ncUser + ':' + s.ncPass)
            };
            if (data !== undefined) headers['Content-Type'] = 'application/json';
            function done(status, text) {
                var obj = null;
                try { obj = JSON.parse(text); } catch (e) { obj = null; }
                if (obj && obj.ocs && obj.ocs.meta) {
                    var meta = obj.ocs.meta;
                    if (meta.status === 'ok') return resolve(obj.ocs.data);
                    var msg = obj.ocs.data && obj.ocs.data.message ? obj.ocs.data.message : (meta.message || ('HTTP ' + meta.statuscode));
                    var err = new Error(msg);
                    err.status = meta.statuscode || status;
                    return reject(err);
                }
                if (status >= 200 && status < 300) return resolve(obj || {});
                if (obj && obj.message) return reject(new Error(obj.message));
                if (obj && obj.error) return reject(new Error(obj.error));
                return reject(new Error('HTTP ' + status));
            }
            if (typeof GM_xmlhttpRequest === 'function') {
                try {
                    GM_xmlhttpRequest({
                        method: method,
                        url: url,
                        headers: headers,
                        data: data !== undefined ? JSON.stringify(data) : null,
                        timeout: 20000,
                        onload: function (r) { done(r.status || 0, r.responseText || ''); },
                        onerror: function () { reject(new Error('Ağ hatası')); },
                        ontimeout: function () { reject(new Error('Zaman aşımı')); }
                    });
                    return;
                } catch (e) { /* fallthrough */ }
            }
            fetch(url, {
                method: method,
                headers: headers,
                body: data !== undefined ? JSON.stringify(data) : undefined
            }).then(function (r) {
                return r.text().then(function (t) { done(r.status, t); });
            }).catch(function (e) { reject(e); });
        });
    }

    var VALID_STATUSES = ['watchlist', 'watching', 'watched', 'on_hold', 'dropped'];

    function listItems(params) {
        var q = '';
        if (params) {
            var parts = [];
            if (params.title) parts.push('search=' + encodeURIComponent(params.title));
            if (params.type) parts.push('type=' + encodeURIComponent(params.type));
            if (params.status) parts.push('status=' + encodeURIComponent(params.status));
            if (parts.length) q = '?' + parts.join('&');
        }
        return ncRequest('GET', '/items' + q, undefined);
    }

    function findLibraryItem(opts) {
        var params = {};
        if (opts.title) params.title = opts.title;
        if (opts.itemType) params.type = opts.itemType;
        return listItems(params).then(function (list) {
            var arr = Array.isArray(list) ? list : [];
            if (opts.tmdbId) {
                for (var i = 0; i < arr.length; i++) {
                    if (arr[i].tmdb_id && String(arr[i].tmdb_id) === String(opts.tmdbId)) return arr[i];
                }
            }
            var nt = opts.title ? normTitle(opts.title) : '';
            for (var j = 0; j < arr.length; j++) if (normTitle(arr[j].title) === nt) return arr[j];
            for (var k = 0; k < arr.length; k++) if (arr[k].item_type === opts.itemType && normTitle(arr[k].title).indexOf(nt) !== -1) return arr[k];
            return null;
        });
    }

    function resolveTmdb(opts) {
        return ncRequest('GET', '/search?query=' + encodeURIComponent(opts.title || ''), undefined).then(function (r) {
            var results = (r && r.results) || [];
            var year = opts.year ? String(opts.year) : '';
            var itemType = opts.itemType === 'tv' ? 'tv' : 'movie';
            var scored = results
                .filter(function (x) { return (x.item_type || itemType) === itemType; })
                .map(function (x) {
                    var score = 0;
                    if (normTitle(x.title) === normTitle(opts.title)) score += 10;
                    else if (normTitle(x.title).indexOf(normTitle(opts.title)) !== -1) score += 5;
                    if (year && String(x.year || '') === year) score += 4;
                    return { x: x, score: score };
                })
                .sort(function (a, b) { return b.score - a.score; });
            if (scored.length && scored[0].score > 0) return scored[0].x;
            return null;
        }).catch(function () { return null; });
    }

    function itemCacheGet(key) { return TVS.storeGet(K_ITEM, {})[key] || null; }
    function itemCacheSet(key, val) {
        var c = TVS.storeGet(K_ITEM, {});
        c[key] = val;
        TVS.storeSet(K_ITEM, c);
    }
    function itemCacheDel(key) {
        var c = TVS.storeGet(K_ITEM, {});
        delete c[key];
        TVS.storeSet(K_ITEM, c);
    }
    function itemKey(opts) {
        return opts.itemType + ':' + normTitle(opts.title) + (opts.tmdbId ? '#' + opts.tmdbId : '');
    }

    function ensureItem(opts) {
        var key = itemKey(opts);
        var cached = itemCacheGet(key);
        var useCache = cached && (opts.tmdbId ? cached.tmdb_id : true);
        if (useCache) return Promise.resolve(cached);

        return resolveTmdb(opts).then(function (tmdb) {
            var meta = tmdb || {};
            return findLibraryItem({ title: opts.title, itemType: opts.itemType, tmdbId: meta.tmdb_id || opts.tmdbId }).then(function (found) {
                if (found) {
                    var c1 = { id: found.id, tmdb_id: found.tmdb_id, title: found.title, item_type: found.item_type };
                    itemCacheSet(key, c1);
                    return found;
                }
                var body = {
                    title: opts.title,
                    item_type: opts.itemType === 'tv' ? 'tv' : 'movie',
                    tmdb_id: meta.tmdb_id || opts.tmdbId,
                    year: meta.year || opts.year,
                    runtime: meta.runtime || opts.runtimeMin,
                    poster_url: meta.poster_url || opts.posterUrl,
                    backdrop_url: meta.backdrop_url || opts.backdropUrl,
                    overview: meta.overview || opts.overview,
                    status: VALID_STATUSES.indexOf(opts.status) !== -1 ? opts.status : 'watchlist'
                };
                Object.keys(body).forEach(function (k) { if (body[k] === undefined || body[k] === null || body[k] === '') delete body[k]; });
                return ncRequest('POST', '/items', body).then(function (created) {
                    var c2 = { id: created.id, tmdb_id: created.tmdb_id, title: created.title, item_type: created.item_type };
                    itemCacheSet(key, c2);
                    logPush('info', 'Kütüphaneye eklendi: ' + created.title + ' (' + created.item_type + ')');
                    return created;
                }).catch(function (e) {
                    if (e.status === 409) {
                        return findLibraryItem({ title: opts.title, itemType: opts.itemType, tmdbId: (tmdb && tmdb.tmdb_id) || opts.tmdbId }).then(function (f) {
                            if (f) {
                                var c3 = { id: f.id, tmdb_id: f.tmdb_id, title: f.title, item_type: f.item_type };
                                itemCacheSet(key, c3);
                                return f;
                            }
                            throw e;
                        });
                    }
                    throw e;
                });
            });
        });
    }

    function updateItem(item, patch) {
        var ok = {};
        ['title', 'item_type', 'tmdb_id', 'year', 'runtime', 'poster_url', 'backdrop_url', 'overview', 'status', 'rating', 'watched_seconds'].forEach(function (k) {
            if (patch[k] !== undefined && patch[k] !== null) ok[k] = patch[k];
        });
        if (ok.status && VALID_STATUSES.indexOf(ok.status) === -1) delete ok.status;
        if (!Object.keys(ok).length) return Promise.resolve(item);
        return ncRequest('PUT', '/items/' + item.id, ok);
    }

    var episodeIdCache = {};
    function getOrCreateEpisode(item, season, episode, runtime) {
        var ck = item.id + ':' + season + ':' + episode;
        if (episodeIdCache[ck]) return Promise.resolve(episodeIdCache[ck]);
        return ncRequest('GET', '/items/' + item.id + '/episodes', undefined).then(function (eps) {
            var arr = Array.isArray(eps) ? eps : [];
            for (var i = 0; i < arr.length; i++) {
                if (arr[i].season_number === season && arr[i].episode_number === episode) {
                    episodeIdCache[ck] = arr[i].id;
                    return arr[i].id;
                }
            }
            var body = { season_number: season, episode_number: episode };
            if (runtime) body.runtime = Math.max(1, runtime);
            return ncRequest('POST', '/items/' + item.id + '/episodes', body).then(function (ep) {
                episodeIdCache[ck] = ep.id;
                return ep.id;
            });
        });
    }

    function upsertEpisode(item, opts) {
        return getOrCreateEpisode(item, Math.max(1, opts.season || 1), Math.max(1, opts.episode || 1), opts.runtime).then(function (epId) {
            var body = {};
            if (opts.watched === true) body.watched = true;
            else if (typeof opts.watchedSeconds === 'number') body.watched_seconds = Math.floor(opts.watchedSeconds);
            if (Object.keys(body).length) return ncRequest('PUT', '/episodes/' + epId, body);
            return { id: epId };
        });
    }

    var resume = TVS.storeGet(K_RESUME, {});
    function resumeKey(p) { return [p.itemType, normTitle(p.title), p.season || 0, p.episode || 0].join(':'); }

    TVS.syncWatch = function (payload) {
        return new Promise(function (resolve, reject) {
            if (!payload || !payload.title) return reject(new Error('Başlık eksik.'));
            var p = {
                itemType: payload.item_type === 'tv' ? 'tv' : 'movie',
                title: String(payload.title).trim(),
                year: payload.year || null,
                season: payload.season ? parseInt(payload.season, 10) : null,
                episode: payload.episode ? parseInt(payload.episode, 10) : null,
                watchedSeconds: typeof payload.watched_seconds === 'number' ? payload.watched_seconds : null,
                duration: typeof payload.duration === 'number' ? payload.duration : null,
                runtime: payload.runtime ? Math.max(1, payload.runtime) : null,
                status: VALID_STATUSES.indexOf(payload.status) !== -1 ? payload.status : null,
                rating: payload.rating,
                watched: !!payload.watched,
                remove: !!payload.remove
            };
            if (!p.runtime && p.duration) p.runtime = Math.max(1, Math.round(p.duration / 60));
            p.runtimeMin = p.runtime;

            var key = itemKey(p);
            var rk = resumeKey(p);
            var rt = resume[rk] || { pos: -1, ts: 0 };
            var now = Date.now();
            var hard = p.remove || p.watched || (p.rating !== null && p.rating !== undefined) || (p.status && p.status !== 'watching');
            var throttleMs = p.duration ? Math.max(10000, Math.floor(p.duration * 0.3) * 1000) : 30000;
            if (!hard && typeof p.watchedSeconds === 'number' && p.watchedSeconds === rt.pos && (now - rt.ts) < throttleMs) {
                return resolve({ throttled: true });
            }

            ensureItem(p).then(function (item) {
                if (!item) return reject(new Error('Öğe bulunamadı/oluşturulamadı.'));
                var chain;
                if (p.itemType === 'tv' && p.season) {
                    chain = upsertEpisode(item, { season: p.season, episode: p.episode || 1, watched: p.watched || undefined, watchedSeconds: p.watchedSeconds, runtime: p.runtime }).then(function () { return null; });
                } else {
                    chain = Promise.resolve().then(function () {
                        var patch = {};
                        if (p.runtime && !item.runtime) patch.runtime = p.runtime;
                        if (p.watched) { patch.status = 'watched'; }
                        else if (typeof p.watchedSeconds === 'number') {
                            var runtimeSec = (item.runtime || 0) * 60;
                            if (p.duration && p.watchedSeconds >= Math.floor(p.duration * 0.9)) patch.status = 'watched';
                            else if (runtimeSec && p.watchedSeconds >= runtimeSec) patch.status = 'watched';
                            else {
                                patch.watched_seconds = Math.floor(p.watchedSeconds);
                                if (p.status && p.status !== 'watched') patch.status = p.status;
                            }
                        }
                        if (p.status && !patch.status) patch.status = p.status;
                        if (p.rating !== null && p.rating !== undefined) patch.rating = Math.max(0, Math.min(10, Math.round(p.rating)));
                        return Object.keys(patch).length ? updateItem(item, patch) : item;
                    });
                }

                chain.then(function () {
                    if (p.remove) {
                        return ncRequest('DELETE', '/items/' + item.id, undefined).then(function () {
                            itemCacheDel(key);
                            delete resume[rk];
                            TVS.storeSet(K_RESUME, resume);
                            logPush('info', 'Listeden çıkarıldı: ' + item.title);
                            return resolve({ removed: true });
                        });
                    }
                    resume[rk] = { pos: typeof p.watchedSeconds === 'number' ? p.watchedSeconds : 0, ts: now };
                    TVS.storeSet(K_RESUME, resume);
                    logPush('info', (p.itemType === 'tv'
                        ? 'Dizi: ' + p.title + ' S' + (p.season || 1) + 'E' + (p.episode || 1)
                        : 'Film: ' + p.title) + (p.watched ? ' → izlendi' : (p.rating !== null && p.rating !== undefined ? ' → puan ' + p.rating : (p.status === 'watchlist' ? ' → liste' : ' → güncellendi'))));
                    return resolve({ item: item });
                }).catch(reject);
            }).catch(function (e) {
                logPush('error', String(e && e.message ? e.message : e));
                reject(e);
            });
        });
    };

    TVS.testConnection = function () {
        return ncRequest('GET', '/settings', undefined);
    };

    function touchPill(ok, msg) {
        var pill = document.getElementById('tvs-pill');
        if (!pill) return;
        pill.className = 'tvs-pill ' + (ok ? 'tvs-ok' : 'tvs-bad');
        var t = pill.querySelector('.tvs-pill-text');
        if (t) t.textContent = msg || (ok ? 'Senkron tamam' : 'Senkron hatası');
        saveSettings({ lastSync: { ts: Date.now(), ok: !!ok, msg: msg || '' } });
    }

    var activeVideo = null;
    var watchingCtx = null;
    var currentMeta = null;
    var lastReport = {};

    function shouldSend(ctx, pos) {
        var key = [ctx.itemType, normTitle(ctx.title), ctx.season || 0, ctx.episode || 0].join(':');
        var lr = lastReport[key] || { pos: -1, ts: 0 };
        if (Math.abs(pos - lr.pos) < 10 && (Date.now() - lr.ts) < 20000) return false;
        lastReport[key] = { pos: pos, ts: Date.now() };
        return true;
    }

    function reportPlayback(force, opts) {
        opts = opts || {};
        if (!watchingCtx) return;
        var vid = activeVideo;
        var pos = 0;
        var dur = null;
        if (vid && isFinite(vid.currentTime)) pos = vid.currentTime;
        if (vid && isFinite(vid.duration) && vid.duration > 0) dur = vid.duration;
        pos = Math.max(0, Math.floor(opts.pos !== undefined ? opts.pos : pos));
        var ctx = watchingCtx;

        if (opts.ended) {
            TVS.syncWatch({
                item_type: ctx.itemType, title: ctx.title, year: ctx.year,
                season: ctx.season, episode: ctx.episode,
                watched: true, status: 'watched', duration: dur
            }).then(function () {
                touchPill(true, 'İzlenen olarak işaretlendi');
            }).catch(function (e) { touchPill(false, e.message); });
            return;
        }

        var payload = {
            item_type: ctx.itemType, title: ctx.title, year: ctx.year,
            season: ctx.season, episode: ctx.episode,
            watched_seconds: pos, duration: dur,
            runtime: dur ? Math.max(1, Math.round(dur / 60)) : null,
            status: 'watching'
        };
        if (force || shouldSend(ctx, pos)) {
            TVS.syncWatch(payload).then(function () {
                touchPill(true, pos > 0 ? 'Konum kaydedildi' : 'İzleniyor');
            }).catch(function (e) { touchPill(false, e.message); });
        }
    }

    function bindVideo(vid) {
        if (!vid || vid.__tvsBound) return;
        vid.__tvsBound = true;
        activeVideo = vid;
        vid.addEventListener('play', function () { watchingCtx = currentMeta; reportPlayback(true); resumeIfNeeded(vid); });
        vid.addEventListener('timeupdate', function () { reportPlayback(false); });
        vid.addEventListener('pause', function () { reportPlayback(true); });
        vid.addEventListener('ended', function () { reportPlayback(true, { ended: true }); });
    }

    function findItemState(ctx) {
        return findLibraryItem({ title: ctx.title, itemType: ctx.itemType }).then(function (it) {
            if (!it) return 0;
            if (ctx.itemType === 'movie') return it.watched_seconds || 0;
            if (ctx.itemType === 'tv' && ctx.season) {
                return ncRequest('GET', '/items/' + it.id + '/episodes', undefined).then(function (eps) {
                    var arr = Array.isArray(eps) ? eps : [];
                    for (var i = 0; i < arr.length; i++) {
                        if (arr[i].season_number === ctx.season && arr[i].episode_number === ctx.episode) return arr[i].watched_seconds || 0;
                    }
                    return 0;
                });
            }
            return 0;
        });
    }

    function resumeIfNeeded(vid) {
        if (vid.__tvsResumeDone) return;
        var ctx = currentMeta;
        if (!ctx) return;
        vid.__tvsResumeDone = true;
        findItemState(ctx).then(function (sec) {
            if (!sec || sec < 30) return;
            function trySeek() {
                if (isFinite(vid.duration) && vid.duration > 0) {
                    if (sec < vid.duration * 0.9) {
                        try { vid.currentTime = sec; logPush('info', 'Devam: ' + Math.round(sec / 60) + ' dakikadan başlatıldı'); } catch (e) { /* noop */ }
                    }
                } else {
                    setTimeout(trySeek, 1200);
                }
            }
            trySeek();
        }).catch(function () { /* noop */ });
    }

    function findVideos() {
        var sel = document.querySelectorAll('#playerContent video, #playerContent .playerjs-video video, .video-wrapper video, video:not(#prerollVideo)');
        for (var i = 0; i < sel.length; i++) {
            var v = sel[i];
            if (!v || v.id === 'prerollVideo') continue;
            if (v.closest && v.closest('.preroll-ad')) continue;
            bindVideo(v);
        }
    }

    var estState = { handle: null, start: 0, last: -1, runtime: null, done: false };

    function resolveEpisodeRuntime(ctx) {
        return new Promise(function (res) {
            function fail() { res(null); }
            if (!ctx || !ctx.title) return fail();
            if (ctx.itemType === 'movie') {
                resolveTmdb({ itemType: 'movie', title: ctx.title, year: ctx.year }).then(function (tmdb) {
                    res((tmdb && tmdb.runtime) || null);
                }).catch(fail);
                return;
            }
            resolveTmdb({ itemType: 'tv', title: ctx.title, year: ctx.year }).then(function (tmdb) {
                if (!tmdb || !tmdb.tmdb_id || !ctx.season) return fail();
                ncRequest('GET', '/season/' + tmdb.tmdb_id + '/' + ctx.season, undefined).then(function (eps) {
                    var arr = Array.isArray(eps) ? eps : [];
                    for (var i = 0; i < arr.length; i++) {
                        if (arr[i].episode_number === (ctx.episode || 1)) return res(arr[i].runtime || null);
                    }
                    res(arr.length ? (arr[0].runtime || null) : null);
                }).catch(fail);
            }).catch(fail);
        });
    }

    function playerStarted() {
        var mc = document.getElementById('mainPlayer');
        if (mc && getComputedStyle(mc).display !== 'none') return true;
        var cover = document.querySelector('.player-cover-overlay');
        if (cover && cover.style.display === 'none') return true;
        var pc = document.getElementById('playerContent');
        if (pc && pc.querySelector('iframe')) return true;
        return false;
    }

    function estimateTick() {
        if (!watchingCtx || estState.done) { stopEstimate(); return; }
        if (activeVideo && activeVideo.currentSrc && !activeVideo.paused) { stopEstimate(); return; }
        var ctx = watchingCtx;
        var pos = Math.floor((Date.now() - estState.start) / 1000);
        var rtSec = estState.runtime ? estState.runtime * 60 : null;
        if (rtSec && pos >= Math.floor(rtSec * 0.9)) {
            estState.done = true;
            stopEstimate();
            TVS.syncWatch({ item_type: ctx.itemType, title: ctx.title, year: ctx.year, season: ctx.season, episode: ctx.episode, watched: true, status: 'watched', runtime: estState.runtime })
                .then(function () { touchPill(true, 'İzleme tamamlandı · izlenen'); })
                .catch(function (e) { touchPill(false, e.message); });
            return;
        }
        if (pos - estState.last < 10) return;
        estState.last = pos;
        TVS.syncWatch({ item_type: ctx.itemType, title: ctx.title, year: ctx.year, season: ctx.season, episode: ctx.episode, watched_seconds: pos, runtime: estState.runtime, status: 'watching' })
            .then(function () { touchPill(true, 'Oynatıcı ilerliyor · ' + Math.floor(pos / 60) + ' dk'); })
            .catch(function (e) { touchPill(false, e.message); });
    }

    function startEstimate() {
        if (estState.handle || estState.done || estState.pending) return;
        if (!watchingCtx || !playerStarted()) return;
        estState.pending = true;
        estState.start = Date.now();
        estState.last = -1;
        resolveEpisodeRuntime(watchingCtx).then(function (rt) {
            estState.pending = false;
            if (estState.done) return;
            estState.runtime = rt;
            estState.handle = setInterval(estimateTick, 15000);
            estimateTick();
        });
    }

    function stopEstimate() {
        if (estState.handle) { clearInterval(estState.handle); estState.handle = null; }
    }

    function bindPlayerMessages() {
        window.addEventListener('message', function (ev) {
            var d = ev.data;
            if (!d) return;
            if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
            if (!d || typeof d !== 'object' || typeof d.event !== 'string') return;
            var evname = String(d.event);
            if (evname.indexOf('PlayerJS') === -1 && evname.indexOf('playerjs') === -1) return;
            if (!watchingCtx) return;
            stopEstimate();
            if (evname.indexOf('progress') !== -1 || evname.indexOf('timeupdate') !== -1 || typeof d.position === 'number') {
                if (typeof d.position === 'number') {
                    var rt = typeof d.duration === 'number' && d.duration > 0 ? Math.max(1, Math.round(d.duration / 60)) : null;
                    TVS.syncWatch({ item_type: watchingCtx.itemType, title: watchingCtx.title, year: watchingCtx.year, season: watchingCtx.season, episode: watchingCtx.episode, watched_seconds: Math.floor(d.position), duration: typeof d.duration === 'number' ? d.duration : null, runtime: rt, status: 'watching' })
                        .then(function () { touchPill(true, 'Konum kaydedildi'); })
                        .catch(function (e) { touchPill(false, e.message); });
                }
            } else if (evname.indexOf('play') !== -1) {
                watchingCtx = currentMeta;
                stopEstimate();
                reportPlayback(true);
                if (!activeVideo) {
                    estState.start = Date.now();
                    estState.last = -1;
                    estState.done = false;
                    estState.runtime = null;
                    resolveEpisodeRuntime(watchingCtx).then(function (rt) { estState.runtime = rt; estState.handle = setInterval(estimateTick, 15000); });
                }
            } else if (evname.indexOf('pause') !== -1) {
                stopEstimate();
                reportPlayback(true);
            } else if (evname.indexOf('ended') !== -1) {
                reportPlayback(true, { ended: true });
            }
        });
    }

    TVS.markWatched = function () {
        var m = currentMeta || TVS.extractMeta();
        if (!m || !m.title) return;
        TVS.syncWatch({ item_type: m.itemType, title: m.title, year: m.year, season: m.season, episode: m.episode, watched: true, status: 'watched' })
            .then(function () { touchPill(true, 'İzlenen olarak işaretlendi'); setStatusBtn('watched'); })
            .catch(function (e) { touchPill(false, e.message); });
    };

    TVS.toggleWatchlist = function () {
        var m = currentMeta || TVS.extractMeta();
        if (!m || !m.title) return;
        var wlKey = 'wl_' + [m.itemType, normTitle(m.title)].join(':');
        var prev = TVS.storeGet(wlKey, false);
        TVS.syncWatch({ item_type: m.itemType, title: m.title, year: m.year, season: m.season, episode: m.episode, status: 'watchlist', remove: !!prev })
            .then(function () {
                TVS.storeSet(wlKey, !prev);
                touchPill(true, prev ? 'İzleme listesinden çıkarıldı' : 'İzleme listesine eklendi');
                var btn = document.getElementById('tvs-btn-wl');
                if (btn) {
                    btn.className = 'tvs-btn ' + (!prev ? 'active' : '');
                    btn.innerHTML = !prev ? 'Listede ✓' : 'İzleme Listesi';
                }
            })
            .catch(function (e) { touchPill(false, e.message); });
    };

    TVS.setRating = function (val) {
        var m = currentMeta || TVS.extractMeta();
        if (!m || !m.title) return;
        TVS.syncWatch({ item_type: m.itemType, title: m.title, year: m.year, season: m.season, episode: m.episode, rating: parseInt(val, 10) })
            .then(function () { touchPill(true, 'Puan kaydedildi'); updateItemState(m); })
            .catch(function (e) { touchPill(false, e.message); });
    };

    TVS.setStatus = function (status) {
        var m = currentMeta || TVS.extractMeta();
        if (!m || !m.title) return;
        TVS.syncWatch({ item_type: m.itemType, title: m.title, year: m.year, season: m.season, episode: m.episode, status: status })
            .then(function () { touchPill(true, 'Durum kaydedildi'); setStatusBtn(status); updateItemState(m); })
            .catch(function (e) { touchPill(false, e.message); });
    };

    function setStatusBtn(status) {
        var s = document.getElementById('tvs-status');
        if (s && status) s.value = status;
        var mbtn = document.getElementById('tvs-btn-watched');
        if (mbtn && status === 'watched') mbtn.className = 'tvs-btn active';
    }

    function updateItemState(m) {
        findLibraryItem({ title: m.title, itemType: m.itemType }).then(function (it) {
            if (!it) return;
            setStatusBtn(it.status || '');
            var r = document.getElementById('tvs-rating');
            if (r && it.rating) r.value = String(it.rating);
        }).catch(function () { /* noop */ });
    }

    TVS.refreshItemState = function () {
        var m = TVS.extractMeta();
        if (!m || !m.title) return;
        updateItemState(m);
    };

    function installButtons() {
        var m = TVS.extractMeta();
        if (!m || (m.pageType !== 'movie' && m.pageType !== 'episode' && m.pageType !== 'series')) return;
        if (document.getElementById('tvs-toolbar')) return;

        function mkBtn(id, txt, fn) {
            var b = document.createElement('button');
            b.id = id;
            b.type = 'button';
            b.className = 'tvs-btn';
            b.innerHTML = txt;
            b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); fn(); });
            return b;
        }
        function mkSelect(id, pairs, fn) {
            var s = document.createElement('select');
            s.id = id;
            s.className = 'tvs-select';
            pairs.forEach(function (p) {
                var o = document.createElement('option');
                o.value = p[0]; o.textContent = p[1];
                s.appendChild(o);
            });
            s.addEventListener('change', function () { if (s.value !== '') fn(s.value); });
            return s;
        }

        var bar = document.createElement('div');
        bar.id = 'tvs-toolbar';
        bar.className = 'tvs-toolbar';

        var btnWl = mkBtn('tvs-btn-wl', 'İzleme Listesi', TVS.toggleWatchlist);
        var btnWatched = mkBtn('tvs-btn-watched', 'İzledim', TVS.markWatched);
        var rating = mkSelect('tvs-rating', [['', 'Puan…'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8'], ['9', '9'], ['10', '10']], TVS.setRating);
        var statusSel = mkSelect('tvs-status', [
            ['', 'Durum…'], ['watchlist', 'Listede'], ['watching', 'İzleniyor'],
            ['watched', 'İzlendi'], ['on_hold', 'Beklemede'], ['dropped', 'Bırakıldı']
        ], TVS.setStatus);

        bar.appendChild(btnWl);
        bar.appendChild(btnWatched);
        bar.appendChild(rating);
        bar.appendChild(statusSel);

        var anchor = null;
        if (m.pageType === 'movie') anchor = document.querySelector('.watch-title-top') || document.querySelector('.film-title') || document.querySelector('.watch-page');
        else if (m.pageType === 'episode') anchor = document.querySelector('.series-hero-actions') || document.querySelector('.series-hero') || document.querySelector('.watch-page');
        else anchor = document.querySelector('.series-hero-actions') || document.querySelector('.series-hero');
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
        else document.body.appendChild(bar);

        updateItemState(m);
    }

    var NOW_TTL = 5 * 60 * 1000;

    function resolveLatestWatched() {
        var cached = TVS.storeGet(K_NOW, null);
        if (cached && cached.ts && (Date.now() - cached.ts) < NOW_TTL) return Promise.resolve(cached.out);
        return listItems().then(function (list) {
            var items = Array.isArray(list) ? list : [];
            var tvItems = items.filter(function (i) { return i && i.item_type === 'tv'; });
            var movieBest = null;
            var movieItems = items.filter(function (i) {
                return i && i.item_type === 'movie' &&
                    (i.status === 'watching' || i.status === 'watched' || (i.watched_seconds || 0) > 0);
            });
            for (var i = 0; i < movieItems.length; i++) {
                var m = movieItems[i];
                var cand = { item: m, episode: null, watched: m.status === 'watched', seconds: m.watched_seconds || 0, ts: m.updated_at || 0 };
                if (!movieBest || cand.ts > movieBest.ts) movieBest = cand;
            }
            var found = [];
            var chain = Promise.resolve();
            tvItems.forEach(function (item) {
                chain = chain.then(function () {
                    return ncRequest('GET', '/items/' + item.id + '/episodes', undefined);
                }).then(function (eps) {
                    var arr = Array.isArray(eps) ? eps : [];
                    var best = null;
                    for (var j = 0; j < arr.length; j++) {
                        var e = arr[j];
                        if (!e || !(e.watched || (e.watched_seconds || 0) > 0)) continue;
                        if (!best || (e.updated_at || 0) > (best.updated_at || 0)) best = e;
                    }
                    if (!best) return;
                    found.push({
                        item: item,
                        episode: best,
                        watched: best.watched || false,
                        seconds: best.watched_seconds || 0,
                        ts: best.updated_at || item.updated_at || 0
                    });
                }).catch(function () { /* skip item */ });
            });
            return chain.then(function () {
                found.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
                var best = found.length ? found[0] : movieBest;
                if (movieBest && (best === null || (best.ts || 0) < (movieBest.ts || 0))) best = movieBest;
                var out = best ? {
                    itemType: best.item.item_type,
                    title: best.item.title,
                    year: best.item.year,
                    poster: best.item.poster_url,
                    season: best.episode ? best.episode.season_number : null,
                    episode: best.episode ? best.episode.episode_number : null,
                    watched: best.watched,
                    ts: best.ts
                } : null;
                TVS.storeSet(K_NOW, { out: out, ts: Date.now() });
                return out;
            });
        }).catch(function () { return cached && cached.out ? cached.out : null; });
    }

    function slugify(s) {
        return String(s || '').toLowerCase().trim()
            .replace(/[çÇ]/g, 'c').replace(/[ğĞ]/g, 'g').replace(/[ıI]/g, 'i')
            .replace(/[öÖ]/g, 'o').replace(/[şŞ]/g, 's').replace(/[üÜ]/g, 'u')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function installNowWatching() {
        if (TVS.pageType() !== 'home') return;
        if (document.getElementById('tvs-now')) return;
        resolveLatestWatched().then(function (best) {
            if (!best) return;
            var html = '';
            var label = 'Son İzlenen';
            var sub = '';
            if (best.itemType === 'tv' && best.season) {
                sub = 'Sezon ' + best.season + ' · Bölüm ' + best.episode;
            } else {
                sub = (best.year || '') ? 'Yıl: ' + best.year : 'Film';
            }
            var img = best.poster ? '<img class="tvs-now-img" src="' + esc(best.poster) + '" alt="" loading="lazy">' : '';
            var href = '';
            if (best.itemType === 'tv' && best.season) {
                href = location.origin + '/bolum/' + slugify(best.title) + '-' + best.season + '-sezon-' + best.episode + '-bolum';
            } else {
                href = location.origin + '/film/' + slugify(best.title);
            }
            html =
                '<div class="tvs-now" id="tvs-now">' +
                '<div class="tvs-now-kicker">' + label + ' <span class="tvs-now-rel">' + shortTime(best.ts * 1000) + '</span></div>' +
                '<a class="tvs-now-card" href="' + href + '">' +
                img +
                '<div class="tvs-now-body">' +
                '<div class="tvs-now-title">' + esc(best.title) + '</div>' +
                '<div class="tvs-now-sub">' + esc(sub) + '</div>' +
                '<div class="tvs-now-cta">İzlemeye devam et →</div>' +
                '</div></div></div>';
            var anchor = document.querySelector('main .trending-section') || document.querySelector('main .section');
            if (!anchor) anchor = document.querySelector('main');
            if (anchor && anchor.parentNode) {
                var wrap = document.createElement('div');
                wrap.innerHTML = html;
                anchor.parentNode.insertBefore(wrap.firstChild, anchor);
            }
        });
    }

    function installPill() {
        if (document.getElementById('tvs-pill')) return;
        var pill = document.createElement('div');
        pill.id = 'tvs-pill';
        pill.className = 'tvs-pill tvs-warn';
        pill.innerHTML = '<span class="tvs-pill-dot"></span><span class="tvs-pill-text">Senkron yapılandırılmadı</span>';
        pill.addEventListener('click', function () { openPanel('settings'); });
        document.body.appendChild(pill);

        var s = getSettings();
        if (!s.ncUrl || !s.ncUser || !s.ncPass) {
            pill.querySelector('.tvs-pill-text').textContent = 'Ayarlar eksik — dokun';
            return;
        }
        if (s.lastSync) {
            var last = s.lastSync;
            pill.className = 'tvs-pill ' + (last.ok ? 'tvs-ok' : 'tvs-bad');
            pill.querySelector('.tvs-pill-text').textContent = (last.ok ? 'Son senkron: ' : 'Hata: ') + shortTime(last.ts) + ' · ' + last.msg;
            refreshPillTimer();
        }
        TVS.testConnection().then(function (r) {
            pill.className = 'tvs-pill tvs-ok';
            pill.querySelector('.tvs-pill-text').textContent = 'Bağlı' + (r && r.configured ? ' · TMDb var' : ' · TMDb yok');
        }).catch(function (e) {
            pill.className = 'tvs-pill tvs-bad';
            pill.querySelector('.tvs-pill-text').textContent = e.message;
        });
    }

    function shortTime(ts) {
        var d = new Date(ts), now = new Date();
        var mins = Math.round((now - d) / 60000);
        if (mins < 1) return 'az önce';
        if (mins < 60) return mins + ' dakika önce';
        return d.toLocaleTimeString();
    }

    function refreshPillTimer() {
        var pill = document.getElementById('tvs-pill');
        if (!pill) return;
        var s = getSettings();
        if (s.lastSync) {
            var last = s.lastSync;
            pill.className = 'tvs-pill ' + (last.ok ? 'tvs-ok' : 'tvs-bad');
            pill.querySelector('.tvs-pill-text').textContent = (last.ok ? 'Son senkron: ' : 'Hata: ') + shortTime(last.ts) + ' · ' + last.msg;
        }
    }

    function buildPanel(view) {
        var overlay = document.getElementById('tvs-panel');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'tvs-panel';
            overlay.className = 'tvs-overlay';
            document.body.appendChild(overlay);
        }
        var s = getSettings();
        var tabs = '<div class="tvs-tabs">' +
            '<button type="button" class="tvs-tab' + (view === 'settings' ? ' active' : '') + '" data-tab="settings">Ayarlar</button>' +
            '<button type="button" class="tvs-tab' + (view === 'status' ? ' active' : '') + '" data-tab="status">Sync Durumu</button>' +
            '</div>';

        var settingsView =
            '<div class="tvs-view" id="tvs-view-settings"' + (view !== 'settings' ? ' style="display:none"' : '') + '>' +
            '<label>Nextcloud adresi</label>' +
            '<input id="tvs-url" type="url" placeholder="https://nextcloud.example.com" value="' + esc(s.ncUrl || '') + '">' +
            '<label>Kullanıcı adı</label>' +
            '<input id="tvs-user" type="text" autocomplete="off" value="' + esc(s.ncUser || '') + '">' +
            '<label>Parola / uygulama parolası</label>' +
            '<input id="tvs-pass" type="password" autocomplete="off" value="' + esc(s.ncPass || '') + '">' +
            '<div class="tvs-row">' +
            '<button type="button" class="tvs-btn" id="tvs-save">Kaydet &amp; Test Et</button>' +
            '<button type="button" class="tvs-btn ghost" id="tvs-test">Test Et</button>' +
            '</div>' +
            '<div class="tvs-status" id="tvs-status-line">—</div>' +
            '<div class="tvs-hint">Desktop: Tampermonkey/Violentmonkey (tam destek). iOS: Userscripts uygulaması — Nextcloud sunucunuzda CORS açık değilse, sanal (iframe) sunucularda yalnızca bölüm seviyesinde izleme yapılır; HTML5 sunucularda saniye seviyesinde devam kaydı çalışır.</div>' +
            '</div>';

        var logItems = TVS.getLog();
        var logHtml = logItems.length
            ? logItems.map(function (l) {
                return '<div class="tvs-log ' + (l.level === 'error' ? 'error' : 'info') + '">' + new Date(l.ts).toLocaleTimeString() + ' · ' + esc(l.msg) + '</div>';
            }).join('')
            : '<div class="tvs-empty">Henüz kayıt yok.</div>';

        var statusView =
            '<div class="tvs-view" id="tvs-view-status"' + (view !== 'status' ? ' style="display:none"' : '') + '>' +
            '<div class="tvs-status" id="tvs-conn-line">Kontrol ediliyor…</div>' +
            '<div class="tvs-logbox" id="tvs-logbox">' + logHtml + '</div>' +
            '<div class="tvs-row">' +
            '<button type="button" class="tvs-btn ghost" id="tvs-test2">Bağlantıyı Test Et</button>' +
            '<button type="button" class="tvs-btn ghost" id="tvs-clear">Günlüğü Temizle</button>' +
            '</div>' +
            '</div>';

        overlay.innerHTML =
            '<div class="tvs-panel tvs-inner">' +
            '<div class="tvs-panel-head"><span class="tvs-wordmark">TELEVISORIUM<span class="tvs-sub"> SYNC</span></span>' +
            '<button type="button" class="tvs-close" id="tvs-close">✕</button></div>' +
            tabs + settingsView + statusView +
            '<div class="tvs-hint tvs-foot">v' + TVS.version + ' · dizipal* → Nextcloud Televisorium</div>' +
            '</div>';
        overlay.style.display = 'flex';
        document.body.style.overflow = 'hidden';

        overlay.addEventListener('click', function (e) {
            var t = e.target;
            if (!t) return;
            if (t.id === 'tvs-close') closePanel();
            if (t.classList && t.classList.contains('tvs-tab')) {
                var v = t.getAttribute('data-tab');
                var v1 = document.getElementById('tvs-view-settings');
                var v2 = document.getElementById('tvs-view-status');
                if (v1) v1.style.display = v === 'settings' ? '' : 'none';
                if (v2) v2.style.display = v === 'status' ? '' : 'none';
                var tabs = overlay.querySelectorAll('.tvs-tab');
                for (var i = 0; i < tabs.length; i++) tabs[i].className = 'tvs-tab' + (tabs[i].getAttribute('data-tab') === v ? ' active' : '');
                if (v === 'status') showConnStatus();
            }
            if (t.id === 'tvs-save') saveAndTest();
            if (t.id === 'tvs-test' || t.id === 'tvs-test2') { readPanelAndSave(); testConn(); }
            if (t.id === 'tvs-clear') { TVS.clearLog(); renderLog(); }
        });
    }

    function readPanel() {
        return {
            ncUrl: document.getElementById('tvs-url').value,
            ncUser: document.getElementById('tvs-user').value,
            ncPass: document.getElementById('tvs-pass').value
        };
    }
    function readPanelAndSave() {
        saveSettings(readPanel());
    }

    function closePanel() {
        var o = document.getElementById('tvs-panel');
        if (o) o.style.display = 'none';
        document.body.style.overflow = '';
    }

    function statusLine(text, ok) {
        var el = document.getElementById('tvs-status-line');
        if (!el) return;
        el.textContent = text;
        el.style.color = ok === undefined ? '' : (ok ? '#3fb950' : '#e50914');
    }

    function saveAndTest() {
        readPanelAndSave();
        statusLine('Giriş test ediliyor…');
        TVS.testConnection().then(function (r) {
            var txt = 'Bağlantı OK · Televisorium yüklü' + (r && r.configured ? ' · TMDb anahtarı var' : ' · TMDb anahtarı yok');
            statusLine(txt, true);
            logPush('info', txt);
            touchPill(true, 'Bağlı');
        }).catch(function (e) {
            statusLine('Hata: ' + e.message, false);
            touchPill(false, e.message);
        });
    }

    function testConn() {
        statusLine('Giriş test ediliyor…');
        TVS.testConnection().then(function (r) {
            statusLine('Bağlantı OK · Televisorium yüklü' + (r && r.configured ? ' · TMDb anahtarı var' : ' · TMDb anahtarı yok'), true);
        }).catch(function (e) { statusLine('Hata: ' + e.message, false); });
    }

    function showConnStatus() {
        var el = document.getElementById('tvs-conn-line');
        if (!el) return;
        el.textContent = 'Kontrol ediliyor…';
        TVS.testConnection().then(function (r) {
            el.textContent = 'Bağlantı OK · TMDb ' + (r && r.configured ? 'yapılandırılmış' : 'yapılandırılmamış');
            el.style.color = '#3fb950';
        }).catch(function (e) {
            el.textContent = 'Hata: ' + e.message;
            el.style.color = '#e50914';
        });
    }

    function renderLog() {
        var box = document.getElementById('tvs-logbox');
        if (!box) return;
        var items = TVS.getLog();
        box.innerHTML = items.length
            ? items.map(function (l) {
                return '<div class="tvs-log ' + (l.level === 'error' ? 'error' : 'info') + '">' + new Date(l.ts).toLocaleTimeString() + ' · ' + esc(l.msg) + '</div>';
            }).join('')
            : '<div class="tvs-empty">Henüz kayıt yok.</div>';
    }

    function openPanel(view) {
        buildPanel(view || 'settings');
    }
    TVS.openPanel = openPanel;

    var AD_SEL = '.announcement-bar,#router-skin-desktop,#router-skin-mobile,#router-header-ads,#footerStickyAd,.footer-sticky-ad,.ad-container,.ad-item,.ad-image,.ad-banner-image,.ad-banner-img,.ad-grid,.ad-grid-mobile,.ad-desktop,.ad-mobile,.ad-banner-container,.embed-text-banner-top,.embed-text-banner-bottom,.embed-text-banner,.pageskin-desktop-wrapper,.pageskin-desktop-image,.pageskin-click-left,.pageskin-click-right,.pageskin-mobile-wrapper,#nogay-notf,.first-notification,.nogay-user-notification,.first-notification_casino-image,.first-notification_title';

    function purgeAds() {
        var nodes = document.querySelectorAll(AD_SEL);
        for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            if (n && n.parentNode) { try { n.parentNode.removeChild(n); } catch (e) { /* noop */ } }
        }
        var vc = document.getElementById('videoContainer');
        if (vc) { try { vc.removeAttribute('data-preroll'); } catch (e) { /* noop */ } }
        var vc2 = document.querySelector('.video-player-container');
        if (vc2) { try { vc2.removeAttribute('data-preroll'); } catch (e) { /* noop */ } }
        try { document.body.classList.remove('has-footer-ad'); } catch (e) { /* noop */ }
        try { document.body.classList.remove('has-pageskin-desktop'); } catch (e) { /* noop */ }
    }

    function prerollGuard() {
        var skip = document.getElementById('skipBtn') || document.getElementById('skipButton');
        if (skip) {
            try { skip.removeAttribute('disabled'); } catch (e) { /* noop */ }
            try { skip.click(); } catch (e) { /* noop */ }
        }
        var resume = document.getElementById('prerollResumeBtn');
        if (resume) { try { resume.click(); } catch (e) { /* noop */ } }
        var pv = document.getElementById('prerollVideo');
        if (pv) {
            try {
                if (!pv.paused) {
                    if (isFinite(pv.duration) && pv.duration > 0) pv.currentTime = pv.duration;
                    pv.pause();
                    pv.muted = true;
                }
            } catch (e) { /* noop */ }
            var wrap = pv.parentNode;
            while (wrap && wrap.id !== 'prerollAd' && wrap !== document.body) wrap = wrap.parentNode;
            if (wrap && wrap.parentNode) { try { wrap.parentNode.removeChild(wrap); } catch (e) { /* noop */ } }
        }
        var ad = document.getElementById('prerollAd');
        if (ad && ad.parentNode) { try { ad.parentNode.removeChild(ad); } catch (e) { /* noop */ } }
    }

    function adCleanupLoop() {
        purgeAds();
        prerollGuard();
        var tries = 0;
        var iv = setInterval(function () {
            tries++;
            purgeAds();
            prerollGuard();
            var mainPlayer = document.getElementById('mainPlayer');
            var playerC = document.getElementById('playerContent');
            if (mainPlayer && getComputedStyle(mainPlayer).display !== 'none') { clearInterval(iv); return; }
            if ((playerC && playerC.querySelector('iframe, video')) || (mainPlayer && mainPlayer.querySelector('video'))) { clearInterval(iv); return; }
            if (tries > 40) clearInterval(iv);
        }, 1500);
    }

    function injectCss() {
        var css =
            '.tvs-pill{position:fixed;bottom:14px;right:14px;z-index:2147483000;display:flex;align-items:center;gap:8px;background:#141414;border:1px solid #333;border-radius:20px;padding:7px 13px;font-size:12px;font-family:Inter,Segoe UI,sans-serif;color:#e5e5e5;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.5);max-width:240px}' +
            '.tvs-pill .tvs-pill-dot{width:8px;height:8px;border-radius:50%;background:#8b949e;flex:none}' +
            '.tvs-pill.tvs-ok .tvs-pill-dot{background:#3fb950}' +
            '.tvs-pill.tvs-bad .tvs-pill-dot{background:#e50914}' +
            '.tvs-pill.tvs-warn .tvs-pill-dot{background:#d29922}' +
            '.tvs-pill-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.tvs-now{margin:14px 0 0;text-align:left}' +
            '.tvs-now-kicker{font-size:11px;font-weight:700;color:#e50914;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px}' +
            '.tvs-now-rel{color:#8b949e;text-transform:none;font-weight:400;margin-left:6px}' +
            '.tvs-now-card{display:flex;gap:14px;align-items:center;background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:10px;text-decoration:none;color:#e5e5e5;-webkit-transition:border-color .2s;transition:border-color .2s}' +
            '.tvs-now-card:hover{border-color:#e50914}.tvs-now-img{width:64px;height:92px;object-fit:cover;border-radius:8px;flex:none;background:#1c1c1c}' +
            '.tvs-now-body{min-width:0}.tvs-now-title{font-size:16px;font-weight:700;color:#fff;margin:0 0 4px}.tvs-now-sub{font-size:13px;color:#8b949e;margin:0 0 8px}' +
            '.tvs-now-cta{font-size:12px;font-weight:600;color:#e50914}' +
            '.tvs-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0 4px;padding:8px 0}' +
            '.tvs-btn{background:#141414;border:1px solid #3f3f3f;color:#e5e5e5;border-radius:6px;padding:6px 12px;font-size:12px;font-family:Inter,Segoe UI,sans-serif;cursor:pointer}' +
            '.tvs-btn:hover{border-color:#e50914}' +
            '.tvs-btn.active{background:#e50914;border-color:#e50914;color:#fff}' +
            '.tvs-select{background:#141414;border:1px solid #3f3f3f;color:#e5e5e5;border-radius:6px;padding:6px 8px;font-size:12px;font-family:Inter,Segoe UI,sans-serif}' +
            '.tvs-overlay{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.72);display:none;align-items:center;justify-content:center;padding:16px}' +
            '.tvs-inner{background:#141414;border:1px solid #333;border-radius:12px;padding:20px;max-width:440px;width:100%;color:#e5e5e5;font-family:Inter,Segoe UI,sans-serif;max-height:90vh;overflow:auto}' +
            '.tvs-panel-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}' +
            '.tvs-wordmark{font-weight:800;font-size:17px}.tvs-sub{color:#e50914}' +
            '.tvs-close{background:none;border:0;color:#8b949e;font-size:18px;cursor:pointer}' +
            '.tvs-tabs{display:flex;gap:6px;border-bottom:1px solid #333;margin-bottom:12px}' +
            '.tvs-tab{background:transparent;border:0;color:#8b949e;padding:7px 12px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent}' +
            '.tvs-tab.active{color:#e5e5e5;border-bottom-color:#e50914}' +
            '.tvs-view label{display:block;font-size:11px;color:#8b949e;margin:10px 0 4px}' +
            '.tvs-view input{width:100%;background:#0d0d0d;border:1px solid #333;color:#e5e5e5;border-radius:6px;padding:9px 10px;font-size:13px;box-sizing:border-box}' +
            '.tvs-row{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}' +
            '.tvs-view .tvs-btn{background:#e50914;border-color:#e50914;color:#fff}' +
            '.tvs-view .tvs-btn.ghost{background:transparent;border-color:#333;color:#e5e5e5}' +
            '.tvs-status{font-size:12px;margin:10px 0 2px;color:#8b949e;min-height:16px}' +
            '.tvs-hint{font-size:11px;color:#8b949e;margin-top:12px;line-height:1.5}' +
            '.tvs-foot{border-top:1px solid #222;padding-top:10px;margin-top:12px}' +
            '.tvs-logbox{max-height:260px;overflow:auto;font-family:ui-monospace,Menlo,monospace;font-size:11px}' +
            '.tvs-log{padding:3px 0;border-bottom:1px solid #21262d;color:#8b949e}' +
            '.tvs-log.error{color:#f85149}' +
            '.tvs-empty{color:#8b949e;font-size:12px;padding:8px 0}' +
            '.announcement-bar,#router-skin-desktop,#router-skin-mobile,#router-header-ads,#footerStickyAd,.footer-sticky-ad,.ad-container,.ad-item,.ad-image,.ad-banner-image,.ad-banner-img,.ad-grid,.ad-grid-mobile,.ad-desktop,.ad-mobile,.ad-banner-container,.embed-text-banner-top,.embed-text-banner-bottom,.embed-text-banner,.pageskin-desktop-wrapper,.pageskin-desktop-image,.pageskin-click-left,.pageskin-click-right,.pageskin-mobile-wrapper,#nogay-notf,.first-notification,.nogay-user-notification,.first-notification_casino-image,.first-notification_title{display:none!important}' +
            'body.has-footer-ad{padding-bottom:0!important}' +
            'body.has-pageskin-desktop{padding-top:0!important}';
        if (typeof GM_addStyle === 'function') GM_addStyle(css);
        else {
            var st = document.createElement('style');
            st.textContent = css;
            document.head.appendChild(st);
        }
    }

    function boot() {
        injectCss();
        purgeAds();
        adCleanupLoop();

        var origStart = window.startPlayer;
        if (typeof origStart === 'function') {
            window.startPlayer = function () {
                purgeAds();
                var ret = origStart.apply(this, arguments);
                setTimeout(prerollGuard, 250);
                return ret;
            };
        }

        var inFrame = false;
        try { inFrame = (window.top !== window.self); } catch (e) { inFrame = true; }
        if (inFrame) {
            var frameIv = setInterval(function () { purgeAds(); prerollGuard(); }, 1500);
            var frameObs = new MutationObserver(function () { purgeAds(); });
            try { frameObs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) { /* noop */ }
            window.addEventListener('pagehide', function () { clearInterval(frameIv); try { frameObs.disconnect(); } catch (e) { /* noop */ } });
            return;
        }

        currentMeta = TVS.extractMeta();
        installPill();
        installNowWatching();
        installButtons();
        findVideos();
        bindPlayerMessages();

        var root = document.body || document.documentElement;
        if (root) {
            var obsT = null;
            var obs = new MutationObserver(function () {
                findVideos();
                installButtons();
                if (obsT) { clearTimeout(obsT); }
                obsT = setTimeout(function () { obsT = null; purgeAds(); }, 300);
            });
            obs.observe(root, { childList: true, subtree: true });
        }

        var fallback = setInterval(function () {
            if (!currentMeta || (currentMeta.pageType !== 'episode' && currentMeta.pageType !== 'movie')) { clearInterval(fallback); return; }
            if (activeVideo) { clearInterval(fallback); return; }
            watchingCtx = currentMeta;
            var started = playerStarted();
            if (started) {
                if (!fallback.reported) {
                    fallback.reported = true;
                    var ctx = currentMeta;
                    TVS.syncWatch({ item_type: ctx.itemType, title: ctx.title, year: ctx.year, season: ctx.season, episode: ctx.episode, watched_seconds: 0, status: 'watching' })
                        .then(function () { touchPill(true, ctx.itemType === 'tv' ? 'Bölüm izleniyor' : 'Film izleniyor'); })
                        .catch(function (e) { touchPill(false, e.message); });
                }
                startEstimate();
            }
        }, 5000);
        setTimeout(function () { clearInterval(fallback); }, 120000);

        var coverEl = document.querySelector('.player-cover-overlay');
        if (coverEl) {
            coverEl.addEventListener('click', function () {
                watchingCtx = currentMeta;
                if (fallback.reported) startEstimate();
            });
        }
        window.addEventListener('pagehide', function () { stopEstimate(); reportPlayback(true); });

        setInterval(refreshPillTimer, 60000);

        if (typeof GM_registerMenuCommand === 'function') {
            try { GM_registerMenuCommand('Televisorium Sync: Ayarlar', function () { openPanel('settings'); }); } catch (e) { /* noop */ }
            try { GM_registerMenuCommand('Televisorium Sync: Durum', function () { openPanel('status'); }); } catch (e) { /* noop */ }
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();