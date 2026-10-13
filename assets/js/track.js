// GA4 events for what visitors actually do: which project, paper or profile
// they open, whether they grab the resume, and how far down the page they get.
// Also sent to PostHog. No-ops when neither is loaded (blocked, or ?notrack opt-out).
(function () {
  'use strict';

  function send(name, params) {
    if (typeof window.gtag === 'function') window.gtag('event', name, params);
    if (window.posthog && window.posthog.capture) window.posthog.capture(name, params);
  }

  function sectionOf(el) {
    var s = el.closest('section[id], header, footer');
    return s ? s.id || s.tagName.toLowerCase() : 'page';
  }

  var PROFILES = {
    'linkedin.com': 'linkedin',
    'x.com': 'x',
    'twitter.com': 'x',
    'leetcode.com': 'leetcode',
  };

  function classify(a) {
    var href = a.getAttribute('href') || '';
    var where = sectionOf(a);

    if (href.indexOf('mailto:') === 0) return ['contact_click', { method: 'email', location: where }];
    if (href.indexOf('tel:') === 0) return ['contact_click', { method: 'phone', location: where }];
    if (/\.pdf($|\?)/i.test(href)) {
      var file = href.split('/').pop().split('?')[0];
      return [/resume/i.test(file) ? 'resume_download' : 'document_download', { file_name: file, location: where }];
    }

    var url;
    try {
      url = new URL(href, location.href);
    } catch (e) {
      return null;
    }
    if (url.origin === location.origin) return null; // in-page anchors

    var host = url.hostname.replace(/^www\./, '');
    if (host === 'github.com') {
      var repo = url.pathname.split('/').filter(Boolean)[1];
      if (repo) {
        var card = a.closest('.award, .cat-item, li');
        var title = card && card.querySelector('.award-title, .cat-name, h3');
        return ['project_click', {
          project: title ? title.textContent.trim() : repo,
          repo: repo,
          location: where,
        }];
      }
      return ['profile_click', { network: 'github', location: where }];
    }
    if (PROFILES[host]) return ['profile_click', { network: PROFILES[host], location: where }];
    return ['outbound_click', { link_domain: host, link_url: url.href, location: where }];
  }

  // Capture phase so clicks still register if another handler stops propagation.
  document.addEventListener('click', function (e) {
    var a = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!a) return;
    var ev = classify(a);
    if (ev) send(ev[0], ev[1]);
  }, true);

  // One section_view per section per page load, once it crosses the middle of
  // the viewport (a ratio threshold never fires on scenes taller than the screen).
  if ('IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var id = en.target.id;
        if (!en.isIntersecting || seen[id]) return;
        seen[id] = true;
        io.unobserve(en.target);
        send('section_view', { section: id });
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    document.querySelectorAll('main section[id], section.scene[id]').forEach(function (s) {
      io.observe(s);
    });
  }
})();
