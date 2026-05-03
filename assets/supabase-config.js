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

  // ── 1. Configuration ─────────────────────────────────────────
  // Remplacer ces valeurs par les vraies depuis le Dashboard Supabase
  var SUPABASE_URL      = 'VOTRE_SUPABASE_URL';       // ex: https://xxxx.supabase.co
  var SUPABASE_ANON_KEY = 'VOTRE_SUPABASE_ANON_KEY';  // clé publique anon

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
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

    // Indique si Supabase est opérationnel
    isReady: function () {
      return !!(window.fvSupabase);
    },

    // Insère un événement de tracking (remplacera progressivement GAS)
    trackEvent: async function (restaurantSlug, eventType, extra) {
      if (!this.isReady()) return { ok: false, reason: 'supabase_not_ready' };
      extra = extra || {};
      try {
        var payload = {
          event_type:  eventType,
          device_id:   extra.deviceId  || localStorage.getItem('device_id') || null,
          session_id:  extra.sessionId || sessionStorage.getItem('fv_session_id') || null,
          src:         extra.src       || null,
          demo:        extra.demo      === true || extra.demo === 'true',
          jour:        new Date().toISOString().slice(0, 10),
          mois:        new Date().getMonth() + 1,
          annee:       new Date().getFullYear(),
          page_url:    window.location.href,
          user_agent:  navigator.userAgent
        };

        // Résoudre restaurant_id depuis le slug
        var resto = await this.getRestaurantBySlug(restaurantSlug);
        if (resto) payload.restaurant_id = resto.id;

        var res = await window.fvSupabase.from('events').insert(payload);
        return { ok: !res.error, error: res.error };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    // Récupère la config d'un restaurant depuis Supabase
    // (remplacera progressivement config.json)
    getRestaurantBySlug: async function (slug) {
      if (!this.isReady() || !slug) return null;
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

    // Inscrit un client (double-write : Brevo reste actif en parallèle)
    registerClient: async function (restaurantSlug, email, firstName, deviceId, src) {
      if (!this.isReady()) return { ok: false, reason: 'supabase_not_ready' };
      try {
        var resto = await this.getRestaurantBySlug(restaurantSlug);
        if (!resto) return { ok: false, reason: 'restaurant_not_found' };

        var res = await window.fvSupabase.from('clients').upsert({
          restaurant_id: resto.id,
          email:         email,
          first_name:    firstName || null,
          device_id:     deviceId  || null,
          src:           src       || null,
          user_agent:    navigator.userAgent
        }, {
          onConflict: 'restaurant_id,email',
          ignoreDuplicates: false
        });

        return { ok: !res.error, error: res.error };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    // Vérifie si un coupon est disponible ce mois (complètera localStorage)
    isCouponAvailable: async function (restaurantSlug, deviceId) {
      if (!this.isReady()) return null;  // null = fallback vers localStorage
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
