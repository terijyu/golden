(() => {
  const productionHosts = new Set(["kijuki.com", "www.kijuki.com"])
  if (!productionHosts.has(window.location.hostname)) return

  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
  const storageKey = "golden.web.campaign.v1"
  const maxAge = 30 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const cleanTags = (read) => Object.fromEntries(utmKeys.flatMap((key) => {
    const value = read(key)?.trim()
    return value && /^[a-z0-9 ._+~|:/-]{1,150}$/i.test(value) ? [[key, value]] : []
  }))
  const params = new URLSearchParams(window.location.search)
  let tags = cleanTags((key) => params.get(key))
  try {
    if (Object.keys(tags).length) {
      // Replace the entire set on a new tagged visit; don't mix campaigns.
      window.localStorage.setItem(storageKey, JSON.stringify({ savedAt: now, tags }))
    } else {
      const saved = JSON.parse(window.localStorage.getItem(storageKey))
      if (saved && Number.isFinite(saved.savedAt) && now >= saved.savedAt && now - saved.savedAt < maxAge) {
        tags = cleanTags((key) => typeof saved.tags?.[key] === "string" ? saved.tags[key] : null)
      }
    }
  } catch {
    // Storage may be disabled; the current URL can still be attributed.
  }
  const isQa = /^tracking_check(?:_|$)/i.test(tags.utm_campaign || "")
  const checkoutIds = new WeakMap()
  document.querySelectorAll("a[data-analytics-plan][data-analytics-plan-id]").forEach((link) => {
    const url = new URL(link.href)
    if (url.origin !== "https://pay.rev.cat") return
    for (const [key, value] of Object.entries(tags)) url.searchParams.set(key, value)
    if (isQa) url.searchParams.set("metadata[golden_traffic]", "qa")
    const checkoutId = window.crypto?.randomUUID?.()
    if (checkoutId) {
      checkoutIds.set(link, checkoutId)
      url.searchParams.set("metadata[golden_checkout_id]", checkoutId)
    }
    // Keep the provider's existing path, package selection and anonymous redemption.
    link.href = url.href
  })

  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[])

  posthog.init("phc_h3YuT7mDhbD6spDirtIdr7kSyIVQmCVprY27V74d9Al", {
    api_host: "https://us.i.posthog.com",
    defaults: "2026-08-30",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: true,
    capture_heatmaps: false,
    disable_session_recording: true,
    person_profiles: "identified_only",
  })

  const capture = (event, properties = {}) => {
    posthog.capture(event, {
      page_path: window.location.pathname,
      source: "website",
      web_analytics_version: 2,
      web_traffic: isQa ? "qa" : "production",
      ...Object.fromEntries(Object.entries(tags).map(([key, value]) => [`web_${key}`, value])),
      ...properties,
    })
  }

  capture("$pageview")

  const trackLink = (event) => {
    if (event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : null
    const link = target?.closest("a")
    if (!link) return

    const ctaSource = link.dataset.analyticsCta
    if (ctaSource) {
      capture("hero_cta_click", { source: ctaSource })
    }

    const tier = link.dataset.analyticsPlan
    const planId = link.dataset.analyticsPlanId
    if (tier && planId) {
      const checkoutId = checkoutIds.get(link)
      const checkout = { tier, plan_id: planId, ...(checkoutId && { web_checkout_id: checkoutId }) }
      capture("plan_selected", checkout)
      // This is an outbound link click; the hosted page or payment may fail.
      capture("checkout_started", { ...checkout, checkout_evidence: "outbound_click" })
    }
  }
  document.addEventListener("click", trackLink)
  document.addEventListener("auxclick", (event) => {
    if (event.button === 1) trackLink(event)
  })

  document.querySelectorAll(".faq-list details").forEach((item) => {
    item.addEventListener("toggle", () => {
      if (!item.open) return
      capture("faq_opened", {
        question: item.querySelector("summary")?.childNodes[0]?.textContent?.trim() || "unknown",
      })
    })
  })

  const pricing = document.querySelector("#pricing")
  if (pricing && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      capture("pricing_viewed")
      observer.disconnect()
    }, { threshold: 0.3 })
    observer.observe(pricing)
  }
})()
