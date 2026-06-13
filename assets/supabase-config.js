/* =================================================================
   Fidelavis — Supabase Client Config  v1.0
   Phase 1 : Initialisation uniquement, aucune logique métier
   =================================================================

   IMPORTANT — Sécurité :
   - Seule la clé ANON est exposée ici (clé publique, c'est normal)
   - La clé SERVICE_ROLE ne doit JAMAIS apparaître dans ce fichier
   - Les accès sont protégés par RLS (Row Level Security) côté Supabase
   - À configurer : remplacer SUPABASE_URL et SUPABASE_ANON_KEY
     avec vos vraies valeurs depuis :
     Supabase Dashboard > Settings > API

   USAGE :
   Inclure dans les pages qui ont besoin de Supabase :
   <script src="/assets/supabase-config.js"></script>
   Puis utiliser window.fvSupabase (client Supabase)
   ou window.fvSupa.* (helpers Fidelavis)
================================================================= */

(function () {

  // Garde-fou : évite double init si la page inclut explicitement ce
  // script ET que core.js l'auto-charge en parallèle (Phase 3).
  if (window.fvSupa) return;

  // ── 1. Configuration ─────────────────────────────────────────
  // Projet Supabase : Fidelavis (eu-west-3)
  // Dashboard : https://supabase.com/dashboard/project/rtdiaeskmyjjwohirhzj
  var SUPABASE_URL      = 'https://rtdiaeskmyjjwohirhzj.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_V9jcAKPdqxhupYWxoejARQ_D_AmOpcZ';

  // ── 2. Chargement du SDK Supabase depuis CDN ─────────────────
  // Supabase JS v2 — CDN officiel
  var SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

  function initClient() {
    if (!window.supabase) {
      console.warn('[Fidelavis] Supabase SDK non chargé');
      return null;
    }
    if (!SUPABASE_URL || SUPABASE_URL === 'VOTRE_SUPABASE_URL') {
      console.warn('[Fidelavis] Supabase non configuré — mode fallback GAS actif');
      return null;
    }
    try {
      // ✅ keepalive: true → la requête survit à un window.location.replace().
      // Indispensable car les pages d'inscription redirigent vers redit.html
      // ~400 ms après le submit et avorteraient sinon le POST Supabase.
      // Limite navigateur : 64 KB par origine en keepalive — largement assez.
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: {
          fetch: function (input, init) {
            init = init || {};
            init.keepalive = true;
            return fetch(input, init);
          }
        }
      });
    } catch (e) {
      console.warn('[Fidelavis] Erreur init Supabase:', e.message);
      return null;
    }
  }

  function loadSDKAndInit() {
    var script = document.createElement('script');
    script.src = SUPABASE_CDN;
    script.onload = function () {
      window.fvSupabase = initClient();
      if (window.fvSupabase) {
        document.dispatchEvent(new Event('fv:supabase:ready'));
      }
    };
    script.onerror = function () {
      console.warn('[Fidelavis] Impossible de charger le SDK Supabase — fallback GAS');
    };
    document.head.appendChild(script);
  }

  // ── 3. Helpers Fidelavis ─────────────────────────────────────
  // API publique : window.fvSupa.*

  window.fvSupa = {

    // Indique si la config Supabase est en place.
    // Pour trackEvent : suffit que SUPABASE_URL/KEY soient configurés
    // (fetch direct, pas de dépendance au SDK).
    // Pour les helpers SDK (registerClient, getRestaurantBySlug) :
    // ajouter un check window.fvSupabase si nécessaire.
    isReady: function () {
      return !!SUPABASE_URL && SUPABASE_URL !== 'VOTRE_SUPABASE_URL';
    },

    // Indique si le SDK Supabase JS est chargé (pour helpers complexes)
    isSdkReady: function () {
      return !!window.fvSupabase;
    },

    // Insère un événement de tracking via fetch direct (pas de SDK requis).
    // Marche immédiatement, sans attendre le chargement async du SDK CDN.
    // keepalive: true → la requête survit aux navigations rapides
    // (typique sur indexnfc.html qui redirige aussitôt après le scan).
    // Le restaurant_id est résolu côté serveur via trigger SQL sur
    // restaurant_slug (migration phase3_events_restaurant_slug_trigger).
    trackEvent: function (restaurantSlug, eventType, extra) {
      if (!this.isReady()) return Promise.resolve({ ok: false, reason: 'supabase_not_configured' });
      extra = extra || {};
      var payload = {
        restaurant_slug: restaurantSlug || null,
        event_type:      eventType      || null,
        device_id:       extra.deviceId  || localStorage.getItem('device_id')        || null,
        session_id:      extra.sessionId || sessionStorage.getItem('fv_session_id')  || null,
        src:             extra.src       || null,
        demo:            extra.demo === true || extra.demo === 'true' || extra.demo === '1',
        jour:            new Date().toISOString().slice(0, 10),
        mois:            new Date().getMonth() + 1,
        annee:           new Date().getFullYear(),
        page_url:        window.location.href,
        user_agent:      navigator.userAgent
      };
      return fetch(SUPABASE_URL + '/rest/v1/events', {
        method: 'POST',
        headers: {
          'apikey':        SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'Content-Type':  'application/json',
          'Prefer':        'return=minimal'
        },
        body:      JSON.stringify(payload),
        keepalive: true
      }).then(function (r) {
        return { ok: r.ok, status: r.status };
      }).catch(function (e) {
        return { ok: false, error: e && e.message };
      });
    },

    // Récupère la config d'un restaurant depuis Supabase
    // (remplacera progressivement config.json)
    getRestaurantBySlug: async function (slug) {
      if (!this.isSdkReady() || !slug) return null;
      try {
        var res = await window.fvSupabase
          .from('restaurants')
          .select('id, slug, name, color, color2, plan, subscription_status, trial_end_date')
          .eq('slug', slug)
          .single();
        return res.data || null;
      } catch (e) {
        return null;
      }
    },

    // Inscrit un client via la RPC fv_register_client (REST direct).
    // NE dépend PLUS du SDK supabase-js (CDN) : ne nécessite que l'URL + la clé
    // → fiable même si le SDK n'est pas (encore) chargé. Dédup par email côté SQL.
    // (Bugfix : avant, registerClient sortait en 'sdk_not_ready' tant que le CDN
    //  n'était pas chargé → l'event signup partait mais aucun client n'était créé,
    //  d'où la jauge d'essai sous-comptée.)
    registerClient: async function (restaurantSlug, email, firstName, deviceId, src) {
      if (!this.isReady()) return { ok: false, reason: 'not_configured' };
      try {
        var res = await fetch(SUPABASE_URL + '/rest/v1/rpc/fv_register_client', {
          method:  'POST',
          headers: {
            'apikey':        SUPABASE_ANON_KEY,
            'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
            'Content-Type':  'application/json'
          },
          body: JSON.stringify({
            p_slug:       restaurantSlug,
            p_email:      email,
            p_first_name: firstName || null,
            p_device_id:  deviceId  || null,
            p_src:        src       || null
          })
        });
        if (!res.ok) return { ok: false, error: 'http ' + res.status };
        var n = await res.json();   // >=0 ok · -1 resto introuvable · -2 email manquant
        if (typeof n !== 'number' || n < 0) {
          return { ok: false, reason: (n === -1 ? 'restaurant_not_found' : 'email_missing') };
        }
        return { ok: true, count: n };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    // Vérifie si un coupon est disponible ce mois (complètera localStorage)
    isCouponAvailable: async function (restaurantSlug, deviceId) {
      if (!this.isSdkReady()) return null;  // null = fallback vers localStorage
      try {
        var monthKey = new Date().toISOString().slice(0, 7);  // "2026-05"
        var resto = await this.getRestaurantBySlug(restaurantSlug);
        if (!resto) return null;

        var res = await window.fvSupabase
          .from('coupons')
          .select('id, status')
          .eq('restaurant_id', resto.id)
          .eq('device_id', deviceId)
          .eq('month_key', monthKey)
          .maybeSingle();

        if (res.error) return null;
        if (!res.data) return true;        // pas encore de coupon ce mois → disponible
        return res.data.status !== 'used'; // disponible si pas encore utilisé
      } catch (e) {
        return null;  // fallback localStorage en cas d'erreur
      }
    }

  };

  // ── 4. Lancement ─────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSDKAndInit);
  } else {
    loadSDKAndInit();
  }

})();
