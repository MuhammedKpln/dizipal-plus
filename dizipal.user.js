// ==UserScript==
// @name         Dizipal Plus
// @namespace    dpn.dizipal-plus
// @version      1.0.4
// @updateURL    https://github.com/MuhammedKpln/dizipal-plus/raw/refs/heads/main/dizipal.user.js
// @downloadURL    https://github.com/MuhammedKpln/dizipal-plus/raw/refs/heads/main/dizipal.user.js
// @description  Netflix skin, adblock, local Favorilerim + İzlemeye Devam Et (precise resume for Playerjs video, episode-level for iframe) and Nextcloud MovieDB sync for dizipal*.com
// @author       dpn
// @match        http*://dizipal*.com/
// @match        http*://dizipal*.com/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      *
// @noframes
// ==/UserScript==

// ==DPN_BEGIN==

(function () {
    'use strict';

    var DPN = window.DPN = window.DPN || {};
    DPN.version = '1.0.4';

    var USE_GM = (typeof GM_getValue === 'function' && typeof GM_setValue === 'function');
    var LS_PREFIX = 'dpn:';
    var K_FAV = 'dpn_favorites';
    var K_PROG = 'dpn_progress';
    var K_SEEN = 'dpn_seen';
    var K_SETTINGS = 'dpn_settings';
    var K_META = 'dpn_meta';

    function lsGet(k) {
        try { return localStorage.getItem(LS_PREFIX + k); } catch (e) { return null; }
    }
    function lsSet(k, v) {
        try { localStorage.setItem(LS_PREFIX + k, v); return true; } catch (e) { return false; }
    }
    function lsDel(k) {
        try { localStorage.removeItem(LS_PREFIX + k); } catch (e) { /* noop */ }
    }

    DPN.storeGet = function (k, def) {
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
    DPN.storeSet = function (k, v) {
        var s = JSON.stringify(v);
        if (USE_GM) {
            try { GM_setValue(k, s); return true; } catch (e) { return false; }
        }
        return lsSet(k, s);
    };
    DPN.storeDel = function (k) {
        if (USE_GM) {
            try { GM_deleteValue(k); } catch (e) { /* noop */ }
            return;
        }
        lsDel(k);
    };
    DPN.storeList = function () {
        if (USE_GM) {
            try { return GM_listValues(); } catch (e) { return []; }
        }
        var out = [];
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.indexOf(LS_PREFIX) === 0) out.push(key.slice(LS_PREFIX.length));
            }
        } catch (e) { /* noop */ }
        return out;
    };

    DPN.getFavorites = function () {
        var f = DPN.storeGet(K_FAV, []);
        return Array.isArray(f) ? f : [];
    };
    DPN.saveFavorites = function (list) {
        DPN.storeSet(K_FAV, list);
    };
    DPN.isFavorite = function (contentType, contentId) {
        var key = (contentType || '') + ':' + (contentId || '');
        return DPN.getFavorites().some(function (it) {
            return (it.contentType + ':' + it.contentId) === key;
        });
    };
    DPN.addFavorite = function (meta) {
        var list = DPN.getFavorites();
        var key = meta.contentType + ':' + meta.contentId;
        var exists = list.some(function (it) { return (it.contentType + ':' + it.contentId) === key; });
        if (!exists) {
            list.push({
                contentType: meta.contentType,
                contentId: meta.contentId,
                title: meta.title || '',
                poster: meta.poster || '',
                year: meta.year || '',
                url: meta.url || '',
                addedAt: Date.now()
            });
            DPN.saveFavorites(list);
        }
        return list;
    };
    DPN.removeFavorite = function (contentType, contentId) {
        var key = contentType + ':' + contentId;
        var list = DPN.getFavorites().filter(function (it) {
            return (it.contentType + ':' + it.contentId) !== key;
        });
        DPN.saveFavorites(list);
        return list;
    };
    DPN.toggleFavorite = function (meta) {
        if (DPN.isFavorite(meta.contentType, meta.contentId)) {
            DPN.removeFavorite(meta.contentType, meta.contentId);
            return false;
        }
        DPN.addFavorite(meta);
        return true;
    };

    DPN.getProgress = function () {
        var p = DPN.storeGet(K_PROG, {});
        return (p && typeof p === 'object') ? p : {};
    };
    DPN.saveProgressAll = function (all) {
        DPN.storeSet(K_PROG, all);
    };
    DPN.getProgressEntry = function (type, id) {
        var key = type + ':' + id;
        return DPN.getProgress()[key] || null;
    };
    DPN.saveProgress = function (type, id, data) {
        var all = DPN.getProgress();
        var key = type + ':' + id;
        var cur = all[key] || {};
        all[key] = {
            type: type,
            id: String(id),
            title: (data.title !== undefined ? data.title : cur.title) || '',
            poster: (data.poster !== undefined ? data.poster : cur.poster) || '',
            url: (data.url !== undefined ? data.url : cur.url) || '',
            year: (data.year !== undefined ? data.year : cur.year) || '',
            series: (data.series !== undefined ? data.series : cur.series) || null,
            seconds: (typeof data.seconds === 'number' ? data.seconds : (cur.seconds || 0)),
            duration: (typeof data.duration === 'number' ? data.duration : (cur.duration !== undefined ? cur.duration : null)),
            seen: (data.seen !== undefined ? data.seen : (cur.seen || 0)),
            iframeFallback: (data.iframeFallback !== undefined ? data.iframeFallback : (cur.iframeFallback || 0)),
            updatedAt: Date.now()
        };
        var e = all[key];
        e.pct = (e.duration && e.duration > 0) ? Math.round((e.seconds / e.duration) * 100) : (e.seen ? 100 : (e.seconds > 0 ? 1 : 0));
        if (e.seen === 1) e.pct = 100;
        DPN.saveProgressAll(all);
        return e;
    };
    DPN.removeProgress = function (type, id) {
        var all = DPN.getProgress();
        delete all[type + ':' + id];
        DPN.saveProgressAll(all);
    };
    DPN.updateProgress = function (type, id, data) {
        return DPN.saveProgress(type, id, data);
    };
    DPN.markSeen = function (type, id, data) {
        var cur = DPN.getProgressEntry(type, id) || {};
        return DPN.saveProgress(type, id, {
            title: cur.title, poster: cur.poster, url: cur.url, year: cur.year, series: cur.series,
            seconds: 0, duration: null, seen: 1
        });
    };
    DPN.getContinueWatching = function () {
        var all = DPN.getProgress();
        var out = [];
        for (var k in all) {
            if (!Object.prototype.hasOwnProperty.call(all, k)) continue;
            var e = all[k];
            if (e.seen === 1) continue;
            if (e.seconds <= 0) continue;
            out.push(e);
        }
        out.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
        return out;
    };

    function readMeta() {
        return DPN.storeGet(K_META, {});
    }
    function saveMeta(m) {
        var cur = readMeta();
        for (var k in m) {
            if (Object.prototype.hasOwnProperty.call(m, k)) cur[k] = m[k];
        }
        DPN.storeSet(K_META, cur);
    }
    DPN.getMeta = readMeta;
    DPN.setMeta = saveMeta;

    DPN.pageType = function () {
        var path = location.pathname || '/';
        var p = path.replace(/\/+$/, '');
        if (p === '' || p === '/' || p === '/index.php') return 'home';
        var seg = p.split('/');
        var root = seg[1] || '';
        if (root === 'bolum') return 'episode';
        if (root === 'dizi') return 'series';
        if (root === 'film') return 'movie';
        if (root === 'filmler' || root === 'diziler' || root === 'trend' ||
            root === 'bolumler' || root === 'kategori' || root === 'platform' ||
            root === 'arama') {
            return 'list';
        }
        var pc = document.getElementById('pageConfig');
        if (pc && pc.getAttribute('data-view-type')) return pc.getAttribute('data-view-type');
        return 'other';
    };

    DPN.extractMeta = function () {
        var type = DPN.pageType();
        var m = { type: type, id: '', title: '', poster: '', year: '', url: location.pathname, series: null };
        var pc = document.getElementById('pageConfig');
        if (pc && pc.getAttribute('data-view-id')) m.id = pc.getAttribute('data-view-id');

        if (type === 'movie') {
            var wb = document.querySelector('.btn-watchlist');
            if (wb && wb.dataset && wb.dataset.contentId && !m.id) m.id = wb.dataset.contentId;
            var ft = document.querySelector('.film-title') || document.querySelector('h1');
            if (ft) m.title = ft.textContent.trim();
            var fp = document.querySelector('.film-poster img');
            if (fp) m.poster = fp.getAttribute('src') || fp.getAttribute('data-src') || '';
            var fy = document.querySelector('.film-year') || document.querySelector('.film-meta .fa-calendar');
            if (fy) m.year = fy.textContent.replace(/[^0-9]/g, '').slice(0, 4);
            else {
                var fyr = document.querySelector('.film-meta span');
                if (fyr) m.year = (fyr.textContent.match(/\d{4}/) || [''])[0];
            }
        } else if (type === 'series') {
            var wbs = document.querySelector('.btn-watchlist');
            if (wbs && wbs.dataset && wbs.dataset.contentId && !m.id) m.id = wbs.dataset.contentId;
            var st = document.querySelector('.series-title');
            if (st) m.title = st.textContent.trim();
            var sp = document.querySelector('.series-hero');
            if (sp) {
                var bg = sp.getAttribute('style') || '';
                var bm = bg.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
                if (bm) m.poster = bm[1];
            }
            var sy = document.querySelector('.series-hero .series-meta, .series-hero span');
        } else if (type === 'episode') {
            var epNav = document.querySelector('.ep-nav-all');
            if (epNav) {
                var h = epNav.getAttribute('href') || '';
                var sm = h.match(/\/dizi\/([^/]+)/);
                if (sm) m.series = { id: sm[1], title: sm[1], season: 0, episode: 0 };
            }
            var um = location.pathname.match(/\/([^/]+)\/([^/]+)-(\d+)-sezon-(\d+)-bolum\/?$/);
            if (um) {
                var slug = um[2];
                var season = parseInt(um[3], 10);
                var episode = parseInt(um[4], 10);
                if (m.series) { m.series.id = m.series.id || slug; m.series.title = m.series.title || slug; }
                else m.series = { id: slug, title: slug, season: season, episode: episode };
                m.series.season = season;
                m.series.episode = episode;
                m.series.dpnTitle = slugTitle(slug);
                m.series.url = '/dizi/' + m.series.id;
                m.title = slug + ' ' + season + '. Sezon ' + episode + '. Bölüm';
            }
            var pc2 = document.getElementById('pageConfig');
            if (pc2 && pc2.getAttribute('data-view-id')) m.id = pc2.getAttribute('data-view-id');
            var tv = document.querySelector('.video-player-container');
            if (tv) {
                var bgs = tv.querySelector('.player-cover-overlay');
                if (bgs) {
                    var bst = bgs.getAttribute('style') || '';
                    var bmm = bst.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
                    if (bmm) m.poster = bmm[1];
                }
            }
            var ehero = document.querySelector('.series-hero');
            if (!m.poster && ehero) {
                var ebg = ehero.getAttribute('style') || '';
                var ebm = ebg.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/);
                if (ebm) m.poster = ebm[1];
            }
            if (m.title.indexOf('undefined') === 0) m.title = '';
        }
        return m;
    };

    function formatTime(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var h = Math.floor(sec / 3600);
        var mm = Math.floor((sec % 3600) / 60);
        var ss = sec % 60;
        if (h > 0) return h + 'sa ' + mm + 'dk';
        if (mm > 0) return mm + 'dk';
        return ss + 'sn';
    }
    DPN.formatTime = formatTime;

    var AD_SELECTORS = [
        '#router-skin-desktop', '#router-skin-mobile',
        '.pageskin-desktop-wrapper', '.pageskin-mobile-wrapper',
        '.pageskin-click-left', '.pageskin-click-right',
        '#footerStickyAd', '#mobileTopAd', '#headerAdPlaceholder',
        '#searchAdPlaceholder', '#videoTopAdPlaceholder', '#videoBottomAdPlaceholder',
        '#footerAdPlaceholder', '.ad-item', '.ad-container', '.ad-banner-container',
        '.ad-grid', '.ad-grid-mobile', '.ad-desktop', '.ad-mobile',
        '.footer-ad-content', '.embed-text-banner', '.preroll-ad',
        '.ad-row', '.ad-unit', '.ad-widget', '.advertisement', '.adsbygoogle',
        '.ad', '[data-ad]', '.reklam', '#reklam', '.ad-banner-img', '.ad-image'
    ];
    DPN.AD_SELECTORS = AD_SELECTORS;

    var SKIN_CSS = '' +
        'html.dpn-on,html.dpn-on body{background:#141414!important;color:#e5e5e5!important;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif!important;}' +
        'html.dpn-on a{color:#e5e5e5;}' +
        'html.dpn-on .main-header{background:#141414!important;border-bottom:1px solid #222;position:sticky;top:0;z-index:1000;}' +
        'html.dpn-on .header-inner{max-width:1280px;margin:0 auto;}' +
        'html.dpn-on .logo-img{height:34px;width:auto;}' +
        'html.dpn-on .nav-menu>li>a,html.dpn-on .mobile-nav a{color:#e5e5e5!important;font-size:14px;font-weight:500;text-transform:none;}' +
        'html.dpn-on .nav-menu>li>a:hover,html.dpn-on .nav-menu>li>a:focus{color:#e50914!important;}' +
        'html.dpn-on .search-input,html.dpn-on #heroSearch,html.dpn-on #mobileSearchInput{background:#1f1f1f!important;border:1px solid #333!important;color:#fff!important;border-radius:4px;}' +
        'html.dpn-on .search-btn{background:#e50914!important;color:#fff!important;border:none!important;border-radius:4px;}' +
        'html.dpn-on .announcement-bar{display:none!important;}' +
        'html.dpn-on .hero-search{background:#141414!important;padding:48px 0 24px;border:none;}' +
        'html.dpn-on .hero-logo-img{filter:drop-shadow(0 0 6px rgba(229,9,20,.6));}' +
        'html.dpn-on .section-title{color:#fff!important;font-size:22px;font-weight:700;letter-spacing:.2px;}' +
        'html.dpn-on .trending-section,html.dpn-on .content-section{margin-top:28px;}' +
        'html.dpn-on .content-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;}' +
        'html.dpn-on .content-card{position:relative;border-radius:6px;overflow:hidden;background:#000;transition:transform .25s ease,box-shadow .25s ease;}' +
        'html.dpn-on .content-card:hover{transform:scale(1.05);z-index:5;box-shadow:0 8px 30px rgba(0,0,0,.8);}' +
        'html.dpn-on .content-card .card-poster img{width:100%;aspect-ratio:2/3;object-fit:cover;display:block;}' +
        'html.dpn-on .content-card .card-info{padding:8px;position:absolute;left:0;right:0;bottom:0;background:linear-gradient(transparent,rgba(0,0,0,.9));}' +
        'html.dpn-on .content-card .card-title{color:#fff;font-size:13px;font-weight:600;margin:0;}' +
        'html.dpn-on .content-card .card-meta{color:#b3b3b3;font-size:12px;}' +
        'html.dpn-on .card-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:52px;height:52px;border-radius:50%;background:rgba(229,9,20,.9);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;opacity:0;transition:opacity .2s;}' +
        'html.dpn-on .content-card:hover .card-play{opacity:1;}' +
        'html.dpn-on .see-all-btn{color:#b3b3b3;font-size:13px;text-transform:uppercase;}' +
        'html.dpn-on .see-all-btn:hover{color:#fff;}' +
        'html.dpn-on .btn-action,html.dpn-on .btn-watchlist{background:#2a2a2a;color:#fff;border-radius:4px;border:1px solid #444;transition:background .2s;}' +
        'html.dpn-on .btn-action.active,html.dpn-on .btn-action:hover{background:#e50914!important;border-color:#e50914;}' +
        'html.dpn-on .btn-outline{background:transparent;border:1px solid #777;color:#fff;border-radius:4px;}' +
        'html.dpn-on .film-title,html.dpn-on .watch-title-top h1,html.dpn-on .series-title{color:#fff;}' +
        'html.dpn-on .film-info-box{background:#1c1c1c;border-radius:10px;padding:18px;border:1px solid #262626;}' +
        'html.dpn-on .film-meta,html.dpn-on .film-description{color:#b3b3b3;}' +
        'html.dpn-on .category-tag{background:#2a2a2a;color:#fff;border-radius:20px;padding:4px 12px;font-size:12px;}' +
        'html.dpn-on .cast-tag{background:#222;border-radius:20px;padding:4px 10px;font-size:12px;color:#e5e5e5;}' +
        'html.dpn-on .series-hero{background-color:#000!important;}' +
        'html.dpn-on .series-hero-overlay{background:linear-gradient(90deg,rgba(0,0,0,.9),rgba(0,0,0,.35));}' +
        'html.dpn-on .btn-watch-first,html.dpn-on .btn-watch-last{background:#e50914;color:#fff;border-radius:4px;font-weight:700;}' +
        'html.dpn-on .episode-item{background:#2a2a2a;color:#fff;border-radius:6px;}' +
        'html.dpn-on .episode-item.active,html.dpn-on .episode-item:hover{background:#e50914;}' +
        'html.dpn-on .episode-item-wrap .ep-watch-tick{color:#b3b3b3;}' +
        'html.dpn-on .episode-item-wrap .ep-watch-tick.seen{color:#2ecc71;}' +
        'html.dpn-on .detail-episode-item{border-radius:6px;}' +
        'html.dpn-on .video-wrapper{border-radius:10px;overflow:hidden;background:#000;}' +
        'html.dpn-on .main-footer{background:#0d0d0d;}' +
        'html.dpn-on .mobile-bottom-nav{background:#141414;border-top:1px solid #222;}' +
        'html.dpn-on .top10-item{background:#1c1c1c;border-radius:8px;overflow:hidden;}' +
        'html.dpn-on .page-title{color:#fff;}' +
        'html.dpn-on .dpn-topbar{position:sticky;top:0;z-index:1200;background:rgba(20,20,20,.98);border-bottom:1px solid #222;}' +
        'html.dpn-on .dpn-topbar-inner{max-width:1280px;margin:0 auto;display:flex;align-items:center;gap:24px;padding:10px 20px;}' +
        'html.dpn-on .dpn-wordmark{color:#e50914;font-size:26px;font-weight:900;letter-spacing:1px;text-decoration:none;}' +
        'html.dpn-on .dpn-nav{display:flex;gap:18px;align-items:center;flex:1;}' +
        'html.dpn-on .dpn-nav a{color:#e5e5e5;font-size:14px;text-decoration:none;font-weight:500;}' +
        'html.dpn-on .dpn-nav a:hover,html.dpn-on .dpn-nav a.active{color:#fff;}' +
        'html.dpn-on .dpn-nav a.active{font-weight:700;}' +
        'html.dpn-on .dpn-actions{display:flex;gap:14px;align-items:center;}' +
        'html.dpn-on .dpn-icon-btn{background:none;border:none;color:#e5e5e5;font-size:18px;cursor:pointer;}' +
        'html.dpn-on .dpn-icon-btn:hover{color:#e50914;}' +
        'html.dpn-on .dpn-row{margin:26px auto 0;max-width:1280px;padding:0 20px;}' +
        'html.dpn-on .dpn-row-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}' +
        'html.dpn-on .dpn-row-title{color:#fff;font-size:20px;font-weight:700;margin:0;}' +
        'html.dpn-on .dpn-row-track{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;scrollbar-width:none;}' +
        'html.dpn-on .dpn-row-track::-webkit-scrollbar{display:none;}' +
        'html.dpn-on .dpn-card{flex:0 0 auto;width:150px;position:relative;border-radius:6px;overflow:hidden;background:#000;text-decoration:none;transition:transform .2s;}' +
        'html.dpn-on .dpn-card:hover{transform:scale(1.06);}' +
        'html.dpn-on .dpn-card img{width:150px;height:225px;object-fit:cover;display:block;}' +
        'html.dpn-on .dpn-card-body{position:absolute;left:0;right:0;bottom:0;padding:8px;background:linear-gradient(transparent,rgba(0,0,0,.95));}' +
        'html.dpn-on .dpn-card-title{color:#fff;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        'html.dpn-on .dpn-card-sub{color:#b3b3b3;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        'html.dpn-on .dpn-progress{height:4px;background:#3a3a3a;border-radius:2px;overflow:hidden;margin-top:6px;}' +
        'html.dpn-on .dpn-progress>span{display:block;height:100%;background:#e50914;border-radius:2px;}' +
        'html.dpn-on .dpn-empty{color:#b3b3b3;font-size:14px;padding:24px 0;}' +
        'html.dpn-on .dpn-banner{max-width:1280px;margin:14px auto 0;padding:0 20px;}' +
        'html.dpn-on .dpn-resume-card{display:flex;align-items:center;gap:16px;background:#1c1c1c;border:1px solid #262626;border-radius:10px;padding:16px 18px;}' +
        'html.dpn-on .dpn-resume-card .dpn-r-play{flex:0 0 auto;width:48px;height:48px;border-radius:50%;background:#e50914;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;border:none;}' +
        'html.dpn-on .dpn-resume-card .dpn-r-info{flex:1;}' +
        'html.dpn-on .dpn-resume-card .dpn-r-title{color:#fff;font-weight:700;font-size:15px;}' +
        'html.dpn-on .dpn-resume-card .dpn-r-sub{color:#b3b3b3;font-size:13px;}' +
        'html.dpn-on .dpn-resume-card .dpn-r-reset{background:none;border:none;color:#b3b3b3;cursor:pointer;font-size:13px;text-decoration:underline;}' +
        'html.dpn-on .dpn-page-overlay{position:fixed;inset:0;z-index:2000;background:#141414;overflow-y:auto;display:none;}' +
        'html.dpn-on .dpn-page-overlay.open{display:block;}' +
        'html.dpn-on .dpn-page-head{position:sticky;top:0;background:#141414;border-bottom:1px solid #222;z-index:5;}' +
        'html.dpn-on .dpn-page-inner{max-width:1280px;margin:0 auto;padding:16px 20px 60px;}' +
        'html.dpn-on .dpn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;}' +
        'html.dpn-on .dpn-settings{border:1px solid #262626;border-radius:10px;padding:20px;max-width:520px;margin:40px auto;background:#1c1c1c;}' +
        'html.dpn-on .dpn-settings label{display:block;color:#b3b3b3;font-size:13px;margin:12px 0 4px;}' +
        'html.dpn-on .dpn-settings input{width:100%;background:#111;border:1px solid #333;color:#fff;border-radius:4px;padding:9px 10px;}' +
        'html.dpn-on .dpn-settings .dpn-btn{background:#e50914;color:#fff;border:none;border-radius:4px;padding:9px 16px;cursor:pointer;font-weight:600;margin:14px 6px 0 0;}' +
        'html.dpn-on .dpn-settings .dpn-btn.ghost{background:#333;}' +
        'html.dpn-on .dpn-settings .dpn-status{margin-top:12px;font-size:13px;min-height:18px;}' +
        'html.dpn-on .dpn-close{background:#333;color:#fff;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-weight:600;}' +
        'html.dpn-on .dpn-mobile-nav{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;}' +
        'html.dpn-on .dpn-mobile-nav a{background:#1f1f1f;color:#fff;padding:8px 14px;border-radius:20px;text-decoration:none;font-size:13px;}' +
        'html.dpn-on .dpn-fav-btn{position:absolute;top:8px;right:8px;z-index:20;width:34px;height:34px;border-radius:50%;background:rgba(20,20,20,.75);border:1px solid rgba(255,255,255,.25);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:15px;opacity:0;transition:opacity .2s,transform .15s,background .2s;}' +
        'html.dpn-on .dpn-fav-btn:hover{transform:scale(1.12);background:rgba(229,9,20,.85);}' +
        'html.dpn-on .dpn-fav-btn.active{background:#e50914;opacity:1;color:#fff;}' +
        'html.dpn-on .content-card:hover .dpn-fav-btn,html.dpn-on .card-link:hover ~ .dpn-fav-btn,html.dpn-on .top10-item:hover .dpn-fav-btn{opacity:1;}' +
        'html.dpn-on .content-card .dpn-fav-btn{position:absolute;top:6px;right:6px;}' +
        'html.dpn-on .dpn-fav-wrap{position:absolute;top:8px;right:8px;z-index:20;}' +
        'html.dpn-on .dpn-fav-wrap .dpn-fav-btn{position:static;opacity:0;}' +
        'html.dpn-on .top10-item .dpn-fav-wrap .dpn-fav-btn{opacity:0;}' +
        '';

    var ADBLOCK_CSS = AD_SELECTORS.map(function (s) {
        return 'html.dpn-on.dpn-adblock ' + s + '{display:none!important;}';
    }).join('') +
        'html.dpn-on.dpn-adblock body.has-pageskin-desktop{padding:0!important;margin:0!important;}' +
        'html.dpn-on.dpn-adblock body.has-footer-ad{padding-bottom:0!important;}' +
        '';

    function addStyle(css) {
        if (typeof GM_addStyle === 'function') {
            try { GM_addStyle(css); return; } catch (e) { /* noop */ }
        }
        var st = document.getElementById('dpn-style');
        if (!st) {
            st = document.createElement('style');
            st.id = 'dpn-style';
            (document.head || document.documentElement).appendChild(st);
        }
        st.textContent += css;
    }
    DPN.addStyle = addStyle;

    function qsa(sel, root) {
        root = root || document;
        try { return Array.prototype.slice.call(root.querySelectorAll(sel)); } catch (e) { return []; }
    }

    DPN.applyAdblock = function () {
        qsa(AD_SELECTORS.join(',')).forEach(function (el) {
            el.style.display = 'none';
        });
        var cover = document.getElementById('playerCover');
        if (cover) cover.style.display = '';
        var vc = document.getElementById('videoContainer');
        if (vc) {
            var pre = vc.getAttribute('data-preroll');
            if (pre) {
                try {
                    var obj = JSON.parse(pre);
                    obj.ads = obj.ads || [];
                    if (obj.ads.length) {
                        obj.ads = [];
                        vc.setAttribute('data-preroll', JSON.stringify(obj));
                    }
                } catch (e) { /* noop */ }
            }
        }
    };

    function blockAdNodes() {
        var obs = new MutationObserver(function (muts) {
            var changed = false;
            muts.forEach(function (mut) {
                for (var i = 0; i < mut.addedNodes.length; i++) {
                    var n = mut.addedNodes[i];
                    if (!n || n.nodeType !== 1) continue;
                    if (n.matches && n.matches(AD_SELECTORS.join(','))) {
                        n.style.display = 'none';
                        changed = true;
                        continue;
                    }
                    if (n.querySelectorAll) {
                        qsa(AD_SELECTORS.join(','), n).forEach(function (el) {
                            el.style.display = 'none';
                        });
                    }
                    if (n.id && n.id.toLowerCase().indexOf('ad-') === 0) {
                        n.style.display = 'none';
                    }
                    var cls = n.className && typeof n.className === 'string' ? n.className : '';
                    if (cls && (cls.indexOf('ad-') === 0 || cls.split(/\s+/).indexOf('ad') !== -1)) {
                        if (n.matches('.ad-container,.ad-item,.ad-banner-container,.ad-grid,.ad-grid-mobile,.ad-desktop,.ad-mobile')) {
                            n.style.display = 'none';
                        }
                    }
                }
            });
            if (changed) {
                var sb = document.getElementById('skipBtn');
                if (sb) { try { sb.click(); } catch (e) { /* noop */ } }
            }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        DPN._adObserver = obs;
    }

    DPN.toast = function (msg, type) {
        type = type || 'info';
        var el = document.createElement('div');
        el.className = 'dpn-toast';
        el.textContent = msg;
        el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:4000;background:#333;color:#fff;padding:12px 22px;border-radius:8px;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,.5);border-left:4px solid #e50914;';
        document.body.appendChild(el);
        setTimeout(function () {
            el.style.opacity = '0';
            el.style.transition = 'opacity .4s';
            setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
        }, 2600);
    };

    DPN.renderCard = function (it) {
        var poster = it.poster || '';
        var title = it.title || '';
        var sub = '';
        var href = it.url || '#';
        var bar = '';
        if (it.type === 'episode' && it.series) {
            sub = it.series.season + '. Sezon ' + it.series.episode + '. Bölüm';
        } else if (it.year) {
            sub = it.year;
        }
        if (typeof it.pct === 'number' && it.pct > 0) {
            bar = '<div class="dpn-progress"><span style="width:' + Math.min(100, it.pct) + '%"></span></div>';
        }
        var img = poster ? '<img src="' + poster + '" loading="lazy" alt="">' : '<div style="width:150px;height:225px;background:#1f1f1f"></div>';
        return '<a class="dpn-card" href="' + href + '">' +
            img +
            '<div class="dpn-card-body">' +
            '<div class="dpn-card-title">' + esc(title) + '</div>' +
            (sub ? '<div class="dpn-card-sub">' + esc(sub) + '</div>' : '') +
            bar +
            '</div></a>';
    };

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    DPN.esc = esc;

    DPN.renderRow = function (kind, entries) {
        var id = kind === 'continue' ? 'dpn-row-continue' : 'dpn-row-favorites';
        var old = document.getElementById(id);
        if (old && old.parentNode) old.parentNode.removeChild(old);
        if (!entries.length) return null;
        var title = kind === 'continue' ? 'İzlemeye Devam Et' : 'Favorilerim';
        var wrap = document.createElement('section');
        wrap.className = 'dpn-row';
        wrap.id = id;
        var cards = entries.map(DPN.renderCard).join('');
        wrap.innerHTML = '<div class="dpn-row-head"><h2 class="dpn-row-title">' + title + '</h2>' +
            (kind === 'continue'
                ? '<button type="button" class="dpn-icon-btn dpn-row-more" data-dpn="continue" title="Tümünü Gör">→</button>'
                : '<button type="button" class="dpn-icon-btn dpn-row-more" data-dpn="favorites" title="Tümünü Gör">→</button>') +
            '</div><div class="dpn-row-track">' + cards + '</div>';
        var more = wrap.querySelector('.dpn-row-more');
        if (more) more.addEventListener('click', function () { DPN.showMyPage(kind); });
        return wrap;
    };

    DPN.renderHomeRows = function () {
        var router = document.getElementById('router');
        if (!router) return;
        var continueWrap = DPN.renderRow('continue', DPN.getContinueWatching());
        var favWrap = DPN.renderRow('favorites', DPN.getFavorites().slice().sort(function (a, b) {
            return (b.addedAt || 0) - (a.addedAt || 0);
        }).slice(0, 12));
        var anchor = null;
        for (var i = 0; i < router.children.length; i++) {
            if (router.children[i].nodeType === 1) { anchor = router.children[i]; break; }
        }
        if (anchor) {
            if (continueWrap) router.insertBefore(continueWrap, anchor);
            if (favWrap) router.insertBefore(favWrap, anchor);
        } else {
            if (continueWrap) router.appendChild(continueWrap);
            if (favWrap) router.appendChild(favWrap);
        }
    };

    function cardInfoFromHref(href) {
        if (!href) return null;
        var mm = href.match(/\/(film|dizi)\/([^\/?]+)/);
        if (!mm) return null;
        return { type: mm[1] === 'film' ? 'movie' : 'series', slug: mm[2] };
    }

    function addCardFavorites() {
        function titleFrom(card, isTop10) {
            var t = card.querySelector(isTop10 ? '.top10-title-text' : '.card-title, .card-info .card-title');
            if (t) return t.textContent.trim();
            var img = card.querySelector('img');
            var alt = img ? (img.getAttribute('alt') || '') : '';
            return alt.replace(/\s*izle\s*$/i, '').trim();
        }
        function posterFrom(card) {
            var img = card.querySelector('img');
            return img ? (img.getAttribute('data-src') || img.getAttribute('src') || '') : '';
        }
        function updateBtn(btn, info) {
            var favs = DPN.getFavorites();
            var is = favs.some(function (f) {
                return f.contentType === info.type &&
                    (f.contentId === info.slug ||
                        (f.url && f.url.indexOf('/' + (info.type === 'movie' ? 'film' : 'dizi') + '/' + info.slug) !== -1));
            });
            btn.classList.toggle('active', is);
        }
        function prepareCard(card) {
            if (card.getAttribute('data-dpn-card-fav')) return;
            card.setAttribute('data-dpn-card-fav', '1');
            var isTop10 = card.classList.contains('top10-item');
            var href = card.getAttribute('href');
            var link = href ? null : card.querySelector('a[href]');
            if (link) href = link.getAttribute('href');
            var info = cardInfoFromHref(href);
            if (!info) return;
            if (isTop10) {
                link = card.querySelector('a[href]');
            }
            var btn = document.createElement('button');
            btn.className = 'dpn-fav-btn';
            btn.title = 'Favorilere Ekle';
            btn.innerHTML = '<i class="fas fa-heart"></i>';
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                var fav = {
                    contentType: info.type,
                    contentId: info.slug,
                    title: titleFrom(card, isTop10),
                    poster: posterFrom(card),
                    year: '',
                    url: href
                };
                var added = DPN.toggleFavorite(fav);
                btn.classList.toggle('active', added);
                btn.title = added ? 'Favorilerden Çıkar' : 'Favorilere Ekle';
                DPN.toast(added ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı', added ? 'success' : 'info');
            });
            if (isTop10 && link) {
                var wrapTop = document.createElement('div');
                wrapTop.className = 'dpn-fav-wrap';
                wrapTop.appendChild(btn);
                link.parentNode.appendChild(wrapTop);
            } else {
                card.appendChild(btn);
            }
            updateBtn(btn, info);
        }
        qsa('.content-card, .top10-item').forEach(prepareCard);
        var hadCards = qsa('.content-card, .top10-item').length > 0;
        if (!hadCards) return;
        var root = document.getElementById('router') || document.body;
        var obs = new MutationObserver(function () {
            qsa('.content-card, .top10-item').forEach(prepareCard);
        });
        obs.observe(root, { childList: true, subtree: true });
        DPN._cardFavObserver = obs;
    }
    DPN.addCardFavorites = addCardFavorites;

    function buildTopbar() {
        var header = document.querySelector('.main-header');
        if (!header) return;
        var nav = header.querySelector('.nav-menu');
        if (nav) {
            var item = document.createElement('li');
            item.innerHTML = '<a href="#" data-dpn="favorites"><i class="fas fa-heart"></i> Favorilerim</a>';
            var item2 = document.createElement('li');
            item2.innerHTML = '<a href="#" data-dpn="continue"><i class="fas fa-clock"></i> İzlemeye Devam Et</a>';
            var item3 = document.createElement('li');
            item3.innerHTML = '<a href="#" data-dpn="settings"><i class="fas fa-cog"></i> Senkron</a>';
            var insertAfter = null;
            var list = nav.children;
            if (list.length) insertAfter = list[list.length - 1];
            nav.appendChild(item);
            nav.appendChild(item2);
            nav.appendChild(item3);
        }
        var mnav = document.querySelector('.mobile-nav');
        if (mnav) {
            var li = document.createElement('li');
            li.innerHTML = '<a href="#" data-dpn="favorites"><i class="fas fa-heart"></i> Favorilerim</a>';
            var li2 = document.createElement('li');
            li2.innerHTML = '<a href="#" data-dpn="continue"><i class="fas fa-clock"></i> İzlemeye Devam Et</a>';
            var li3 = document.createElement('li');
            li3.innerHTML = '<a href="#" data-dpn="settings"><i class="fas fa-cog"></i> Senkron</a>';
            mnav.appendChild(li);
            mnav.appendChild(li2);
            mnav.appendChild(li3);
        }
        header.addEventListener('click', function (e) {
            var t = e.target;
            while (t && t !== header && !(t.getAttribute && t.getAttribute('data-dpn'))) t = t.parentNode;
            if (!t || t === header) return;
            var action = t.getAttribute('data-dpn');
            if (action === 'favorites') DPN.showMyPage('favorites');
            else if (action === 'continue') DPN.showMyPage('continue');
            else if (action === 'settings') DPN.openSettings();
            e.preventDefault();
            e.stopPropagation();
        });
        var mobileMenu = document.getElementById('mobileMenu');
        if (mobileMenu) {
            mobileMenu.addEventListener('click', function (e) {
                var t = e.target;
                while (t && t !== mobileMenu && !(t.getAttribute && t.getAttribute('data-dpn'))) t = t.parentNode;
                if (!t || t === mobileMenu) return;
                var action = t.getAttribute('data-dpn');
                if (action === 'favorites') { DPN.showMyPage('favorites'); var btn = document.getElementById('mobileToggle'); if (btn) btn.click(); }
                else if (action === 'continue') { DPN.showMyPage('continue'); var btn2 = document.getElementById('mobileToggle'); if (btn2) btn2.click(); }
                else if (action === 'settings') { DPN.openSettings(); var btn3 = document.getElementById('mobileToggle'); if (btn3) btn3.click(); }
                e.preventDefault();
            });
        }
    }

    DPN.showMyPage = function (kind) {
        var overlay = document.getElementById('dpn-page');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'dpn-page';
            overlay.className = 'dpn-page-overlay';
            document.body.appendChild(overlay);
        }
        var title = kind === 'favorites' ? 'Favorilerim' : 'İzlemeye Devam Et';
        var items = kind === 'favorites' ? DPN.getFavorites() : DPN.getContinueWatching();
        var inner = items.map(function (it, idx) {
            var poster = it.poster || '';
            var img = poster ? '<img src="' + poster + '" alt="" loading="lazy">' : '';
            var bar = '';
            if (it.type && typeof it.pct === 'number' && it.pct > 0 && !(it.type && it.type === 'favorite')) {
                bar = '<div class="dpn-progress"><span style="width:' + Math.min(100, it.pct) + '%"></span></div>';
            }
            var sub = '';
            if (it.type === 'episode' && it.series) sub = it.series.season + '. Sezon ' + it.series.episode + '. Bölüm';
            else if (it.year) sub = it.year;
            return '<div class="dpn-page-card">' +
                '<a class="dpn-card" href="' + (it.url || '#') + '">' + img +
                '<div class="dpn-card-body"><div class="dpn-card-title">' + esc(it.title) + '</div>' +
                (sub ? '<div class="dpn-card-sub">' + esc(sub) + '</div>' : '') + bar + '</div></a>' +
                (kind === 'continue'
                    ? '<button type="button" class="dpn-page-del" data-i="' + idx + '">İzledim</button>'
                    : '<button type="button" class="dpn-page-del" data-i="' + idx + '">Kaldır</button>') +
                '</div>';
        }).join('');

        overlay.innerHTML = '<div class="dpn-page-head"><div class="dpn-page-inner" style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;max-width:1280px;margin:0 auto;">' +
            '<span class="dpn-wordmark" style="font-size:22px;">DIZIPAL<span style="color:#e5e5e5">+</span></span>' +
            '<button type="button" class="dpn-close" id="dpn-page-close">Kapat</button></div></div>' +
            '<div class="dpn-page-inner"><h2 class="dpn-row-title">' + title + '</h2>' +
            (inner ? '<div class="dpn-grid">' + inner + '</div>' : '<div class="dpn-empty">Henüz bir şey yok.</div>') +
            '</div>';

        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        overlay.addEventListener('click', function (e) {
            var t = e.target;
            if (t && t.id === 'dpn-page-close') { overlay.classList.remove('open'); document.body.style.overflow = ''; }
            if (t && t.classList && t.classList.contains('dpn-page-del')) {
                var i = parseInt(t.getAttribute('data-i'), 10);
                if (kind === 'favorites') {
                    var f = DPN.getFavorites();
                    if (f[i]) { DPN.removeFavorite(f[i].contentType, f[i].contentId); DPN.toast('Favorilerden kaldırıldı'); }
                } else {
                    var cw = DPN.getContinueWatching();
                    if (cw[i]) {
                        DPN.saveProgress(cw[i].type, cw[i].id, { seen: 1 });
                        DPN.toast('İzlendi olarak işaretlendi');
                    }
                }
                DPN.showMyPage(kind);
            }
        });
    };

    DPN.openSettings = function () {
        var s = DPN.storeGet(K_SETTINGS, {});
        var overlay = document.getElementById('dpn-settings');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'dpn-settings';
            overlay.className = 'dpn-page-overlay';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = '<div class="dpn-page-head"><div class="dpn-page-inner" style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;max-width:1280px;margin:0 auto;">' +
            '<span class="dpn-wordmark" style="font-size:22px;">DIZIPAL<span style="color:#e5e5e5">+</span></span>' +
            '<button type="button" class="dpn-close" id="dpn-settings-close">Kapat</button></div></div>' +
            '<div class="dpn-settings">' +
            '<h2 class="dpn-row-title">Nextcloud MovieDB Senkron</h2>' +
            '<p style="color:#b3b3b3;font-size:13px;">İzleme listesi (Favorilerim) ve izlenen filmleriniz Nextcloud\'daki MovieDB uygulamasıyla senkronize edilir. Masamüstü (Tampermonkey/Violentmonkey) tam destek; iOS\'ta sunucu CORS ayarlarına bağlıdır.</p>' +
            '<label>Nextcloud Adresi</label><input id="dpn-nc-url" type="url" placeholder="https://nextcloud.example.com" value="' + esc(s.ncUrl || '') + '">' +
            '<label>Kullanıcı Adı</label><input id="dpn-nc-user" type="text" value="' + esc(s.ncUser || '') + '">' +
            '<label>Uygulama Parolası</label><input id="dpn-nc-pass" type="password" value="' + esc(s.ncPass || '') + '">' +
            '<button type="button" class="dpn-btn" id="dpn-sync-test">Bağlantıyı Test Et</button>' +
            '<button type="button" class="dpn-btn ghost" id="dpn-sync-push">Yukarı Gönder</button>' +
            '<button type="button" class="dpn-btn ghost" id="dpn-sync-pull">Aşağı Çek</button>' +
            '<button type="button" class="dpn-btn ghost" id="dpn-sync-save">Ayarları Kaydet</button>' +
            '<div class="dpn-status" id="dpn-sync-status">Hazır.</div>' +
            '</div>';
        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';

        function readForm() {
            return {
                ncUrl: (document.getElementById('dpn-nc-url').value || '').replace(/\/+$/, ''),
                ncUser: document.getElementById('dpn-nc-user').value,
                ncPass: document.getElementById('dpn-nc-pass').value
            };
        }
        function status(msg) {
            var el = document.getElementById('dpn-sync-status');
            if (el) el.textContent = msg;
        }
        overlay.addEventListener('click', function (e) {
            var t = e.target;
            if (t && t.id === 'dpn-settings-close') {
                overlay.classList.remove('open');
                document.body.style.overflow = '';
                return;
            }
            if (t && t.id === 'dpn-sync-save') {
                DPN.storeSet(K_SETTINGS, readForm());
                status('Ayarlar kaydedildi.');
                return;
            }
            if (t && t.id === 'dpn-sync-test') {
                DPN.storeSet(K_SETTINGS, readForm());
                status('Test ediliyor...');
                DPN.ncRequest('GET', '/stats', null, readForm()).then(function (r) {
                    status('Bağlantı OK (' + (r && (r.movies || r.total) ? 'veri alındı' : 'yanıt alındı') + ').');
                }).catch(function (err) {
                    status('Bağlantı hatası: ' + (err && err.message ? err.message : String(err)));
                });
                return;
            }
            if (t && t.id === 'dpn-sync-push') {
                DPN.storeSet(K_SETTINGS, readForm());
                status('Yukarı gönderiliyor...');
                DPN.syncPush().then(function (msg) { status(msg); }).catch(function (err) {
                    status('Senkron hatası: ' + (err && err.message ? err.message : String(err)));
                });
                return;
            }
            if (t && t.id === 'dpn-sync-pull') {
                DPN.storeSet(K_SETTINGS, readForm());
                status('Aşağı çekiliyor...');
                DPN.syncPull().then(function (msg) { status(msg); }).catch(function (err) {
                    status('Senkron hatası: ' + (err && err.message ? err.message : String(err)));
                });
                return;
            }
        });
    };

    function utf8btoa(str) {
        try {
            if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(str)));
        } catch (e) { /* noop */ }
        return '';
    }

    DPN.ncRequest = function (method, path, data, cfg) {
        cfg = cfg || DPN.storeGet(K_SETTINGS, {});
        var base = (cfg.ncUrl || '').replace(/\/+$/, '');
        return new Promise(function (resolve, reject) {
            if (!base) return reject(new Error('Nextcloud adresi ayarlanmamış.'));
            if (!cfg.ncUser) return reject(new Error('Kullanıcı adı eksik.'));
            var url = base + '/apps/moviedb/api' + path;
            var headers = { 'Content-Type': 'application/json', 'OCS-APIRequest': 'true' };
            if (cfg.ncUser && cfg.ncPass) headers['Authorization'] = 'Basic ' + utf8btoa(cfg.ncUser + ':' + cfg.ncPass);

            function parse(text) {
                try { return JSON.parse(text); } catch (e) { return null; }
            }
            function done(status, text) {
                var obj = parse(text);
                if (status >= 200 && status < 300) {
                    if (obj && obj.error) return reject(new Error(obj.error));
                    return resolve(obj || {});
                }
                if (obj && obj.error) return reject(new Error(obj.error));
                return reject(new Error('HTTP ' + status));
            }
            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: method,
                    url: url,
                    headers: headers,
                    data: data ? JSON.stringify(data) : null,
                    onload: function (res) { done(res.status || 0, res.responseText || ''); },
                    onerror: function () { reject(new Error('Ağ hatası')); },
                    ontimeout: function () { reject(new Error('Zaman aşımı')); },
                    timeout: 15000
                });
                return;
            }
            var opts = {
                method: method,
                headers: headers,
                body: data ? JSON.stringify(data) : undefined
            };
            fetch(url, opts).then(function (res) {
                return res.text().then(function (txt) { done(res.status, txt); });
            }).catch(function (e) { reject(e); });
        });
    };

    function lower(s) {
        return String(s || '').toLowerCase();
    }

    DPN.syncPush = function () {
        var cfg = DPN.storeGet(K_SETTINGS, {});
        var favs = DPN.getFavorites();
        var cw = DPN.getProgress();
        var doneMovies = [];
        for (var k in cw) {
            if (!Object.prototype.hasOwnProperty.call(cw, k)) continue;
            var e = cw[k];
            if (e.seen === 1 || (e.pct && e.pct >= 90)) doneMovies.push(e);
        }
        var chain = DPN.ncRequest('GET', '/watchlist', null, cfg).then(function (r) {
            var server = (r && r.items) || [];
            var byTitle = {};
            server.forEach(function (it) { byTitle[lower(it.title)] = it; });
            var jobs = [];
            favs.forEach(function (f) {
                if (byTitle[lower(f.title)]) return;
                jobs.push(DPN.ncRequest('POST', '/watchlist', {
                    title: f.title,
                    posterPath: f.poster,
                    releaseDate: f.year ? (f.year + '-01-01') : null,
                    priority: 0,
                    notes: 'dizipal:' + f.contentType + ':' + f.contentId
                }, cfg));
            });
            return Promise.all(jobs).then(function () {
                return { added: jobs.length };
            });
        });
        return chain.then(function (res) {
            var total = (res.added || 0) + doneMovies.length;
            return total + ' öğe gönderildi (favori + izlenen).';
        });
    };

    DPN.syncPull = function () {
        var cfg = DPN.storeGet(K_SETTINGS, {});
        var favs = DPN.getFavorites();
        var existing = {};
        favs.forEach(function (f) { existing[lower(f.title)] = true; });
        return DPN.ncRequest('GET', '/watchlist', null, cfg).then(function (r) {
            var items = (r && r.items) || [];
            var added = 0;
            items.forEach(function (it) {
                var t = it.title || '';
                if (!t || existing[lower(t)]) return;
                DPN.addFavorite({
                    contentType: 'movie',
                    contentId: 'nc-' + (it.id || t),
                    title: t,
                    poster: it.posterPath || '',
                    year: (it.releaseDate || '').slice(0, 4) || '',
                    url: '#',
                    addedAt: Date.now()
                });
                existing[lower(t)] = true;
                added++;
            });
            return added + ' öğe içe aktarıldı (Favorilerim).';
        });
    };

    function sanitizeDebugger(src) {
        return String(src == null ? '' : src).replace(/\bdebugger\b\s*?;?/g, ';');
    }
    DPN.sanitizeDebugger = sanitizeDebugger;

    function fetchRaw(url, ondone) {
        if (typeof GM_xmlhttpRequest === 'function') {
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    onload: function (res) { ondone(res && res.responseText || ''); },
                    onerror: function () { ondone(''); }
                });
                return;
            } catch (e) { /* fallthrough */ }
        }
        try {
            fetch(url).then(function (r) {
                return r.text().then(ondone);
            }).catch(function () { ondone(''); });
        } catch (e) { ondone(''); }
    }

    function installDebuggerKiller() {
        // 1) Injected / eval'd code: strip `debugger` from sources passed to eval and Function.
        var uw = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
        var flags = DPN.storeGet(K_SETTINGS, {});
        if (flags.debuggerKill === false) return;
        var hasOwn = Object.prototype.hasOwnProperty;
        var fnToString = Function.prototype.toString;
        try {
            if (uw.eval && !uw.eval.__dpn) {
                var re = uw.eval;
                var ne = function (code) {
                    if (typeof code === 'string' && /\bdebugger\b/.test(code)) code = sanitizeDebugger(code);
                    return re(code);
                };
                ne.__dpn = true;
                try { uw.eval = ne; } catch (e) { /* noop */ }
            }
        } catch (e) { /* noop */ }
        try {
            var rfunc = uw.Function;
            var sfunc = function () {
                var args = [];
                for (var i = 0; i < arguments.length; i++) {
                    var a = arguments[i];
                    args.push((typeof a === 'string' && /\bdebugger\b/.test(a)) ? sanitizeDebugger(a) : a);
                }
                return rfunc.apply(this, args);
            };
            sfunc.__dpn = true;
            try { uw.Function = sfunc; } catch (e) { /* noop */ }
            try { if (!(Function.prototype.constructor && Function.prototype.constructor.__dpn)) Function.prototype.constructor = sfunc; } catch (e) { /* noop */ }
        } catch (e) { /* noop */ }

        // 2) Timer-based anti-debug: skip callbacks whose source references `debugger`.
        function sieve(name) {
            try {
                var orig = uw[name];
                if (!orig || orig.__dpn) return;
                var wrap = function (fn, delay) {
                    var args = [];
                    for (var i = 0; i < arguments.length; i++) args[i] = arguments[i];
                    if (typeof fn === 'function') {
                        try {
                            if (/\bdebugger\b/.test(fnToString.call(fn))) {
                                fn = function () {};
                            }
                        } catch (e) { /* noop */ }
                    } else if (typeof fn === 'string') {
                        fn = sanitizeDebugger(fn);
                    }
                    args[0] = fn;
                    return orig.apply(this, args);
                };
                wrap.__dpn = true;
                try { uw[name] = wrap; } catch (e) { /* noop */ }
            } catch (e) { /* noop */ }
        }
        sieve('setInterval');
        sieve('setTimeout');

        // 3) Rewrite the site's own `pal.js` (literal `debugger` statements) before it runs.
        var fixedRe = /^(?:.*\/)?(pal|main)\.js(?:\?.*)?$/i;
        var handled = {};
        function tryRewrite(s) {
            if (!s || s.nodeType !== 1 || s.nodeName !== 'SCRIPT') return;
            var src = s.getAttribute && s.getAttribute('src');
            if (!src) return;
            if (!fixedRe.test(src.split('/').pop())) return;
            if (s.getAttribute('data-dpn-fixed')) return;
            if (handled[src]) return;
            handled[src] = true;
            s.setAttribute('data-dpn-fixed', '1');
            var abs = (/^https?:\/\//i.test(src) ? src : (location.origin || '') + src);
            fetchRaw(abs, function (code) {
                if (!code || !/\bdebugger\b/.test(code)) return;
                try {
                    var blob = new Blob([sanitizeDebugger(code)], { type: 'text/javascript' });
                    var u = (window.URL || window.webkitURL).createObjectURL(blob);
                    s.setAttribute('src', u);
                } catch (e) { /* keep original */ }
            });
        }
        try {
            var obs = new MutationObserver(function (muts) {
                for (var i = 0; i < muts.length; i++) {
                    var nodes = muts[i].addedNodes;
                    for (var j = 0; j < nodes.length; j++) {
                        var n = nodes[j];
                        if (n && n.nodeType === 1) {
                            tryRewrite(n);
                            if (n.querySelectorAll) {
                                var subs = n.querySelectorAll('script[src]');
                                for (var k = 0; k < subs.length; k++) tryRewrite(subs[k]);
                            }
                        }
                    }
                }
            });
            obs.observe(document.documentElement || document, { childList: true, subtree: true });
            DPN._debuggerKillObserver = obs;
        } catch (e) { /* noop */ }
        try {
            var existing = document.querySelectorAll('script[src]');
            for (var x = 0; x < existing.length; x++) tryRewrite(existing[x]);
        } catch (e) { /* noop */ }
    }
    DPN.installDebuggerKiller = installDebuggerKiller;

    function contentKey(type, id) {
        return type + ':' + id;
    }

    function getCurrentMeta() {
        var m = DPN.extractMeta();
        if (m.type === 'movie') return { type: 'movie', id: m.id || m.url, title: m.title, poster: m.poster, year: m.year, url: m.url, series: null };
        if (m.type === 'episode') return { type: 'episode', id: m.id || m.url, title: m.title, poster: m.poster, year: '', url: m.url, series: m.series };
        if (m.type === 'series') return { type: 'series', id: m.id || m.url, title: m.title, poster: m.poster, year: m.year, url: m.url, series: null };
        return null;
    }

    var resumePending = 0;
    DPN.setResumePending = function (sec) { resumePending = sec; };

    function makeTracker(meta) {
        var t = {
            inst: null,
            video: null,
            resumeDone: false,
            lastSave: 0,
            start: 0,
            meta: meta,
            bindInst: function (inst) {
                var self = this;
                self.inst = inst;
                try {
                    if (typeof inst.on === 'function') {
                        inst.on('timeupdate', function (d) { self._onTime(d); });
                        inst.on('pause', function () { self._save(); });
                        inst.on('play', function () { self._maybeResume(); });
                        inst.on('ended', function () { self._ended(); });
                        inst.on('ready', function () { self._maybeResume(); });
                    }
                } catch (e) { /* noop */ }
                self._maybeResume();
            },
            bindVideo: function (video) {
                var self = this;
                self.video = video;
                var add = function (ev, fn) {
                    try { video.addEventListener(ev, fn); } catch (e) { /* noop */ }
                };
                add('timeupdate', function () {
                    self._onTime({ seconds: video.currentTime, duration: video.duration || 0 });
                });
                add('pause', function () { self._save(); });
                add('play', function () { self._maybeResume(); });
                add('ended', function () { self._ended(); });
                add('loadedmetadata', function () { self._maybeResume(); });
            },
            _onTime: function (d) {
                var sec = 0, dur = 0;
                if (d) {
                    sec = typeof d.seconds === 'number' ? d.seconds : (typeof d.currentTime === 'number' ? d.currentTime : 0);
                    dur = typeof d.duration === 'number' ? d.duration : 0;
                }
                if (this.video && this.video.readyState > 0) {
                    if (!dur || dur === Infinity) dur = this.video.duration || 0;
                    if (!sec) sec = this.video.currentTime || 0;
                }
                var now = Date.now();
                if (now - this.lastSave > 3000) {
                    this.lastSave = now;
                    DPN.saveProgress(this.meta.type, this.meta.id, {
                        title: this.meta.title, poster: this.meta.poster, url: this.meta.url,
                        year: this.meta.year, series: this.meta.series,
                        seconds: sec, duration: dur > 0 ? dur : null, seen: 0
                    });
                } else {
                    this._draft = { seconds: sec, duration: dur > 0 ? dur : null };
                }
            },
            _save: function () {
                var d = this._draft || { seconds: 0, duration: null };
                DPN.saveProgress(this.meta.type, this.meta.id, {
                    title: this.meta.title, poster: this.meta.poster, url: this.meta.url,
                    year: this.meta.year, series: this.meta.series,
                    seconds: d.seconds, duration: d.duration, seen: 0
                });
                this._draft = null;
            },
            _maybeResume: function () {
                if (this.resumeDone) return;
                var p = DPN.getProgressEntry(this.meta.type, this.meta.id);
                var want = resumePending || (p && p.seconds > 10 && p.pct > 0 && p.pct < 98 ? p.seconds : 0);
                resumePending = 0;
                this.resumeDone = true;
                if (want > 0) this._seekTo(want);
            },
            _seekTo: function (sec) {
                if (this.inst && typeof this.inst.seek === 'function') {
                    try { this.inst.seek(sec); return; } catch (e) { /* noop */ }
                }
                if (this.video) {
                    try {
                        var apply = function () {
                            try {
                                if (!isNaN(this.video.duration) && this.video.duration > 0 && sec < this.video.duration - 1) {
                                    this.video.currentTime = sec;
                                }
                            } catch (e) { /* noop */ }
                        }.bind(this);
                        apply();
                    } catch (e) { /* noop */ }
                }
            },
            _ended: function () {
                DPN.saveProgress(this.meta.type, this.meta.id, {
                    title: this.meta.title, poster: this.meta.poster, url: this.meta.url,
                    year: this.meta.year, series: this.meta.series, seconds: 0, duration: null, seen: 1
                });
            }
        };
        return t;
    }

    DPN.hookupNativeVideo = function (meta, video) {
        var t = makeTracker(meta);
        t.bindVideo(video);
        return t;
    };

    DPN.renderNativePlayer = function (opts, meta) {
        var container = document.getElementById(opts.id) || document.getElementById('playerContent');
        if (!container) container = document.body;
        container.innerHTML = '';
        if (meta) {
            try { container.setAttribute('data-dpn-meta', JSON.stringify(meta)); } catch (e) { /* noop */ }
        }
        var video = document.createElement('video');
        video.setAttribute('controls', 'controls');
        video.setAttribute('playsinline', 'playsinline');
        if (opts.poster) video.setAttribute('poster', opts.poster);
        video.setAttribute('src', opts.file);
        video.style.cssText = 'width:100%;height:100%;background:#000;';
        container.appendChild(video);
        var tracker = meta ? makeTracker(meta) : null;
        if (tracker) tracker.bindVideo(video);
        var api = {
            _video: video,
            _tracker: tracker,
            on: function () { return api; },
            play: function () { try { var p = video.play(); return p; } catch (e) { return undefined; } },
            pause: function () { try { video.pause(); } catch (e) { /* noop */ } return api; },
            seek: function (t) { try { video.currentTime = t; } catch (e) { /* noop */ } return api; },
            getCurrentTime: function (cb) { try { cb(video.currentTime); } catch (e) { /* noop */ } },
            getDuration: function (cb) { try { cb(video.duration || 0); } catch (e) { /* noop */ } },
            destroy: function () {
                try { video.pause(); } catch (e) { /* noop */ }
                try { if (container && video.parentNode) container.removeChild(video); } catch (e) { /* noop */ }
            }
        };
        return api;
    };

    var playerBridge = (function () {
        var real = null;
        var wrapped = false;
        var pending = [];
        var wrapper = null;

        function installWrapper() {
            if (wrapped) return;
            wrapped = true;
            var Real = real;
            wrapper = function PlayerjsProxy(options) {
                var inst = null;
                var meta = null;
                var pc = document.getElementById('playerContent');
                if (pc) meta = pc.getAttribute('data-dpn-meta');
                var m = null;
                if (meta) {
                    try { m = JSON.parse(meta); } catch (e) { m = null; }
                }
                if (!m) m = getCurrentMeta();
                if (Real) {
                    try { inst = new Real(options); } catch (e) { inst = null; }
                }
                var tracker = null;
                if (m) tracker = makeTracker(m);
                if (!inst && m) {
                    try { inst = DPN.renderNativePlayer(options, m); } catch (e) { inst = null; }
                }
                var proxy = {
                    _dpnProxy: true,
                    _inner: inst,
                    _tracker: tracker,
                    _opts: options,
                    on: function (ev, cb) {
                        if (inst && typeof inst.on === 'function') {
                            try { inst.on(ev, cb); } catch (e) { /* noop */ }
                        }
                        if (tracker && typeof tracker.on === 'function') tracker.on(ev, cb);
                        return proxy;
                    },
                    play: function () { if (inst && typeof inst.play === 'function') { try { return inst.play(); } catch (e) { /* noop */ } } return proxy; },
                    pause: function () { if (inst && typeof inst.pause === 'function') { try { inst.pause(); } catch (e) { /* noop */ } } return proxy; },
                    seek: function (t) {
                        if (tracker && typeof tracker._seekTo === 'function') tracker._seekTo(t);
                        if (inst && typeof inst.seek === 'function') { try { inst.seek(t); } catch (e) { /* noop */ } }
                        return proxy;
                    },
                    getCurrentTime: function (cb) {
                        if (inst && typeof inst.getCurrentTime === 'function') {
                            try { inst.getCurrentTime(cb); return; } catch (e) { /* noop */ }
                        }
                        cb(0);
                    },
                    getDuration: function (cb) {
                        if (inst && typeof inst.getDuration === 'function') {
                            try { inst.getDuration(cb); return; } catch (e) { /* noop */ }
                        }
                        cb(0);
                    },
                    loadVideo: function (f) { if (inst && typeof inst.loadVideo === 'function') { try { inst.loadVideo(f); } catch (e) { /* noop */ } } return proxy; },
                    destroy: function () {
                        if (inst && typeof inst.destroy === 'function') { try { inst.destroy(); } catch (e) { /* noop */ } }
                        if (tracker && typeof tracker._save === 'function') tracker._save();
                    }
                };
                if (tracker) {
                    if (inst && inst._video) tracker.bindVideo(inst._video);
                    else tracker.bindInst(proxy);
                }
                return proxy;
            };
            wrapper.dpnWrapped = true;
            window.Playerjs = wrapper;
            var pr = pending.slice();
            pending = [];
            pr.forEach(function (fn) { try { fn(); } catch (e) { /* noop */ } });
        }

        function loadReal() {
            if (typeof window.Playerjs === 'function' && !window.Playerjs.dpnWrapped) {
                real = window.Playerjs;
                installWrapper();
                return;
            }
            var s = document.createElement('script');
            s.src = (location.origin || '') + '/playerjs.js';
            s.onload = function () {
                if (typeof window.Playerjs === 'function' && !window.Playerjs.dpnWrapped) {
                    real = window.Playerjs;
                }
                installWrapper();
            };
            s.onerror = function () {
                installWrapper();
            };
            try { document.head.appendChild(s); } catch (e) { installWrapper(); }
        }

        return {
            init: function () {
                if (window.Playerjs && window.Playerjs.dpnWrapped) return;
                loadReal();
            },
            whenWrapped: function (fn) {
                if (wrapped) { try { fn(); } catch (e) { /* noop */ } }
                else pending.push(fn);
            }
        };
    })();
    DPN.playerBridge = playerBridge;

    function watchPlayerContent() {
        var main = document.getElementById('mainPlayer');
        if (!main) return;
        var meta = getCurrentMeta();
        var seen = false;
        var obs = new MutationObserver(function () {
            if (seen) return;
            var v = document.querySelector('#mainPlayer video, #playerContent video');
            if (v && !v.getAttribute('data-dpn-tracked')) {
                seen = true;
                if (meta) DPN.hookupNativeVideo(meta, v);
            }
            var ifr = document.querySelector('#mainPlayer iframe, #playerContent iframe');
            if (ifr && meta) {
                if (meta.type === 'episode') {
                    DPN.saveProgress(meta.type, meta.id, {
                        title: meta.title, poster: meta.poster, url: meta.url, year: meta.year,
                        series: meta.series, seconds: 1, duration: null, seen: 0, iframeFallback: 1
                    });
                } else if (meta.type === 'movie') {
                    DPN.saveProgress(meta.type, meta.id, {
                        title: meta.title, poster: meta.poster, url: meta.url, year: meta.year,
                        series: null, seconds: 1, duration: null, seen: 0, iframeFallback: 1
                    });
                }
            }
        });
        obs.observe(main, { childList: true, subtree: true });
    }

    function injectResumeBanner() {
        var meta = getCurrentMeta();
        if (!meta || (meta.type !== 'movie' && meta.type !== 'episode')) return;
        var p = DPN.getProgressEntry(meta.type, meta.id);
        if (!p || p.seconds <= 0 || p.seen === 1) return;
        var wrap = document.createElement('div');
        wrap.className = 'dpn-banner';
        wrap.id = 'dpn-resume';
        var label = p.duration ? ('İzlendi: ' + formatTime(p.seconds) + ' · %' + p.pct) : 'Kaldığın yerden devam et';
        wrap.innerHTML = '<div class="dpn-resume-card">' +
            '<button type="button" class="dpn-r-play" id="dpn-r-play"><i class="fas fa-play"></i></button>' +
            '<div class="dpn-r-info"><div class="dpn-r-title">' + esc(p.title) + '</div>' +
            '<div class="dpn-r-sub">' + label + '</div></div>' +
            '<button type="button" class="dpn-r-reset" id="dpn-r-reset">Baştan Başla</button>' +
            '</div>';
        var target = document.querySelector('#videoContainer') || document.querySelector('.video-wrapper') ||
            document.querySelector('.watch-page .container') || document.getElementById('router');
        if (target) {
            target.parentNode.insertBefore(wrap, target);
        } else {
            document.body.insertBefore(wrap, document.body.firstChild);
        }
        var playBtn = document.getElementById('dpn-r-play');
        if (playBtn) {
            playBtn.addEventListener('click', function () {
                DPN.setResumePending(p.seconds);
                var cover = document.getElementById('playerCover');
                if (cover) { cover.click(); }
                else if (typeof window.startPlayer === 'function') { window.startPlayer(); }
                var b = document.getElementById('dpn-resume');
                if (b && b.parentNode) b.parentNode.removeChild(b);
            });
        }
        var reset = document.getElementById('dpn-r-reset');
        if (reset) {
            reset.addEventListener('click', function () {
                DPN.removeProgress(meta.type, meta.id);
                var b = document.getElementById('dpn-resume');
                if (b && b.parentNode) b.parentNode.removeChild(b);
                DPN.toast('İlerleme sıfırlandı');
            });
        }
    }

    function slugTitle(slug) {
        return String(slug || '').replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    function favoriteInfoFor(btn) {
        var meta = getCurrentMeta();
        var ct = btn.getAttribute('data-content-type') || (meta && meta.type === 'movie' ? 'movie' : 'series');
        var cid = btn.getAttribute('data-content-id') || (meta && meta.id) || '';
        var title = '', poster = '', year = '', url = '';
        if (meta && meta.type === 'episode' && meta.series && ct === 'series') {
            title = meta.series.dpnTitle || slugTitle(meta.series.title || meta.series.id);
            url = meta.series.url || meta.url || (location.pathname || '/');
            poster = meta.poster || '';
            year = meta.year || '';
        } else {
            title = btn.getAttribute('data-title') || (meta && meta.title) || '';
            url = meta && meta.url ? meta.url : (location.pathname || '/');
            poster = (meta && meta.poster) || '';
            year = (meta && meta.year) || '';
        }
        return { contentType: ct, contentId: cid, title: title, poster: poster, year: year, url: url };
    }

    function initActionOverrides() {
        document.addEventListener('click', function (e) {
            var btn = e.target;
            if (btn && btn.closest) btn = btn.closest('.btn-watchlist');
            if (!btn) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            var info = favoriteInfoFor(btn);
            var added = DPN.toggleFavorite(info);
            btn.classList.toggle('active', added);
            var span = btn.querySelector('span');
            if (span) span.textContent = added ? 'Favorilerden Çıkar' : 'Favorilerime Ekle';
            var ic = btn.querySelector('i');
            if (ic) ic.className = added ? 'fas fa-check' : 'fas fa-plus';
            DPN.toast(added ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı', added ? 'success' : 'info');
        }, true);
    }

    function restoreFavoriteButtons() {
        var meta = getCurrentMeta();
        var any = false;
        qsa('.btn-watchlist').forEach(function (btn) {
            var ct = btn.getAttribute('data-content-type');
            var cid = btn.getAttribute('data-content-id');
            var key = ct + ':' + cid;
            var isFav = DPN.getFavorites().some(function (it) { return it.contentType + ':' + it.contentId === key; });
            btn.classList.toggle('active', isFav);
            var span = btn.querySelector('span');
            if (span) span.textContent = isFav ? 'Favorilerden Çıkar' : 'Favorilerime Ekle';
            var ic = btn.querySelector('i');
            if (ic) ic.className = isFav ? 'fas fa-check' : 'fas fa-plus';
            if (!btn.getAttribute('data-title')) {
                if (meta && meta.type === 'episode' && meta.series && ct === 'series') {
                    btn.setAttribute('data-title', meta.series.dpnTitle || slugTitle(meta.series.title || meta.series.id));
                } else if (meta && meta.title) {
                    btn.setAttribute('data-title', meta.title);
                }
            }
            any = true;
        });
        if (!any && meta && (meta.type === 'movie' || meta.type === 'episode' || meta.type === 'series')) {
            var container = null;
            if (meta.type === 'movie') container = document.querySelector('.film-actions');
            else if (meta.type === 'episode' || meta.type === 'series') container = document.querySelector('.series-hero-actions');
            if (container) {
                var key2 = (meta.type === 'episode' ? 'series' : meta.type) + ':' + (meta.type === 'episode' ? (meta.series ? meta.series.id : '') : meta.id);
                var isFav2 = DPN.getFavorites().some(function (it) { return (it.contentType + ':' + it.contentId) === key2; });
                var btn2 = document.createElement('button');
                btn2.className = 'btn-action btn-watchlist';
                btn2.setAttribute('data-content-type', meta.type === 'episode' ? 'series' : meta.type);
                btn2.setAttribute('data-content-id', meta.type === 'episode' ? (meta.series ? meta.series.id : '') : meta.id);
                if (meta.type === 'episode' && meta.series) btn2.setAttribute('data-title', meta.series.dpnTitle || meta.series.title);
                btn2.setAttribute('data-dpn-created', '1');
                btn2.innerHTML = '<i class="fas ' + (isFav2 ? 'fa-check' : 'fa-plus') + '"></i><span>' + (isFav2 ? 'Favorilerden Çıkar' : 'Favorilerime Ekle') + '</span>';
                btn2.classList.toggle('active', isFav2);
                container.appendChild(btn2);
            }
        }
    }

    function initEpisodeSeen() {
        function paint() {
            qsa('.ep-watch-tick').forEach(function (btn) {
                var id = btn.getAttribute('data-episode-id');
                if (!id) return;
                var p = DPN.getProgressEntry('episode', id);
                if (p && p.seen === 1) btn.classList.add('seen');
                else btn.classList.remove('seen');
            });
            qsa('.detail-episode-item, .episode-item').forEach(function (a) {
                var href = a.getAttribute('href') || '';
                if (a.classList.contains('episode-item')) {
                    var wrap = a.closest('.episode-item-wrap');
                    var tick = wrap && wrap.querySelector('.ep-watch-tick');
                    var epId = tick ? tick.getAttribute('data-episode-id') : '';
                    if (epId) {
                        var p2 = DPN.getProgressEntry('episode', epId);
                        if (p2 && p2.seen === 1) a.classList.add('watched');
                        else a.classList.remove('watched');
                    }
                }
            });
        }
        document.addEventListener('click', function (e) {
            var t = e.target;
            if (t && t.closest) t = t.closest('.ep-watch-tick');
            if (!t) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
            var id = t.getAttribute('data-episode-id');
            if (!id) return;
            var cur = DPN.getProgressEntry('episode', id);
            var isSeen = !!(cur && cur.seen === 1);
            if (isSeen) {
                DPN.saveProgress('episode', id, {
                    title: cur.title, poster: cur.poster, url: cur.url, year: cur.year,
                    series: cur.series, seconds: 0, duration: null, seen: 0
                });
            } else {
                DPN.markSeen('episode', id);
            }
            paint();
        }, true);
        paint();
    }

    DPN.init = function () {
        var html = document.documentElement;
        if (!html) return;
        html.classList.add('dpn-on');
        if (DPN.storeGet(K_SETTINGS, {}).adblock !== false) html.classList.add('dpn-adblock');
        installDebuggerKiller();
        addStyle(SKIN_CSS);
        if (html.classList.contains('dpn-adblock')) addStyle(ADBLOCK_CSS);
        DPN.applyAdblock();
        blockAdNodes();
        DPN.playerBridge.init();
        DPN.initActionOverrides = initActionOverrides;
        DPN.restoreFavoriteButtons = restoreFavoriteButtons;
        DPN.initEpisodeSeen = initEpisodeSeen;
        DPN.injectResumeBanner = injectResumeBanner;
        DPN.watchPlayerContent = watchPlayerContent;
        initActionOverrides();

        function onReady() {
            if (document.body) {
                document.body.classList.remove('has-footer-ad');
                document.body.classList.remove('has-pageskin-desktop');
            }
            var type = DPN.pageType();
            if (type === 'home') {
                buildTopbar();
                DPN.renderHomeRows();
                DPN.addCardFavorites();
            } else if (type === 'list') {
                buildTopbar();
                DPN.addCardFavorites();
            } else if (type === 'movie' || type === 'episode') {
                buildTopbar();
                restoreFavoriteButtons();
                injectResumeBanner();
                watchPlayerContent();
            } else if (type === 'series') {
                buildTopbar();
                restoreFavoriteButtons();
                initEpisodeSeen();
            }
            if (type === 'episode') initEpisodeSeen();
            if (type === 'movie' || type === 'episode' || type === 'series') {
                qsa('.btn-watchlist').forEach(function (b) {
                    var ct = b.getAttribute('data-content-type');
                    var cid = b.getAttribute('data-content-id');
                    if (!b.getAttribute('data-dpn-titled')) {
                        b.setAttribute('data-dpn-titled', '1');
                        var mm = getCurrentMeta();
                        if (mm && mm.type === 'episode' && mm.series && ct === 'series') {
                            b.setAttribute('data-title', mm.series.dpnTitle || slugTitle(mm.series.title || mm.series.id));
                        } else if (mm && mm.title) {
                            b.setAttribute('data-title', mm.title);
                        }
                    }
                });
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', onReady);
        } else {
            onReady();
        }
    };

    if (typeof GM_registerMenuCommand === 'function') {
        try {
            GM_registerMenuCommand('Dizipal Plus: Favorilerim', function () {
                DPN.showMyPage('favorites');
            });
            GM_registerMenuCommand('Dizipal Plus: İzlemeye Devam Et', function () {
                DPN.showMyPage('continue');
            });
            GM_registerMenuCommand('Dizipal Plus: Ayarlar / Senkron', function () {
                DPN.openSettings();
            });
        } catch (e) { /* noop */ }
    }

    function hostAllowed() {
        var h = location.hostname || '';
        return /^dizipal[\w-]*\.com$/i.test(h);
    }

    if (hostAllowed()) {
        DPN.init();
    }
})();

// ==DPN_END==
