import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"

const tracker = readFileSync(new URL("../golden/analytics.js", import.meta.url), "utf8")
const html = readFileSync(new URL("../golden/index.html", import.meta.url), "utf8")

function load({ search = "", storage = new Map(), now = Date.now(), disabled = false } = {}) {
  class Link {
    constructor(href, dataset) {
      this.href = href
      this.dataset = dataset
    }
    closest(selector) { return selector === "a" ? this : null }
  }
  const plans = [...html.matchAll(/<a\b[^>]*href="(https:\/\/pay\.rev\.cat\/[^"]+)"[^>]*data-analytics-plan="([^"]+)"[^>]*data-analytics-plan-id="([^"]+)"/g)]
    .map(([, href, analyticsPlan, analyticsPlanId]) =>
      new Link(href.replaceAll("&amp;", "&"), { analyticsPlan, analyticsPlanId }))
  assert.equal(plans.length, 2)
  const events = []
  const listeners = {}
  const posthog = {
    __SV: 1,
    init: (_, config) => assert.equal(config.capture_pageview, false),
    capture: (name, props) => events.push({ name, props }),
  }
  const window = {
    location: new URL(`https://kijuki.com/golden/${search}`),
    get localStorage() {
      if (disabled) throw new Error("storage disabled")
      return { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
    },
    crypto: { randomUUID },
    posthog,
  }
  const document = {
    querySelectorAll: (selector) => selector.startsWith("a[") ? plans : [],
    querySelector: () => null,
    addEventListener: (name, fn) => { listeners[name] = fn },
  }
  runInNewContext(tracker, { window, document, posthog, Element: Link, URL, URLSearchParams, Date: { now: () => now } })
  return { plans, events, listeners, storage }
}

test("landing and both checkout links retain attribution without replacing RevenueCat identity", () => {
  const search = "?utm_source=instagram&utm_medium=paid_social&utm_campaign=golden_ig01_storefront&utm_content=florist_1hr&fbclid=not-forwarded"
  const { plans, events, listeners } = load({ search })
  assert.equal(events.length, 1)
  assert.equal(events[0].name, "$pageview")
  assert.equal(events[0].props.web_utm_content, "florist_1hr")
  assert.equal(events[0].props.web_traffic, "production")
  for (const [i, plan] of plans.entries()) {
    const url = new URL(plan.href)
    assert.equal(url.origin, "https://pay.rev.cat")
    assert.equal(url.pathname.split("/").filter(Boolean).length, 1)
    assert.equal(url.searchParams.get("package_id"), ["golden_monthly", "buddy_monthly"][i])
    assert.equal(url.searchParams.get("hide_back_button"), "true")
    assert.equal(url.searchParams.get("utm_campaign"), "golden_ig01_storefront")
    assert.equal(url.searchParams.has("fbclid"), false)
    assert.equal(url.searchParams.has("app_user_id"), false)
    listeners[i ? "auxclick" : "click"]({ target: plan, button: i })
    assert.equal(events.at(-2).name, "plan_selected")
    assert.equal(events.at(-1).name, "checkout_started")
    assert.equal(events.at(-1).props.checkout_evidence, "outbound_click")
    assert.equal(events.at(-1).props.web_checkout_id, url.searchParams.get("metadata[golden_checkout_id]"))
    assert.ok(events.at(-1).props.web_checkout_id)
  }
  assert.notEqual(events[2].props.web_checkout_id, events[4].props.web_checkout_id)
  assert.equal(events.some((e) => /purchase/.test(e.name)), false)
})

test("QA survives direct return, then a new tagged visit replaces it without mixing tags", () => {
  const storage = new Map()
  load({ search: "?utm_source=instagram&utm_campaign=tracking_check_20261107", storage, now: 0 })
  const direct = load({ storage, now: 1000 })
  assert.equal(direct.events[0].props.web_traffic, "qa")
  assert.equal(new URL(direct.plans[0].href).searchParams.get("metadata[golden_traffic]"), "qa")
  const newCampaign = load({ search: "?utm_campaign=another_campaign", storage, now: 2000 })
  assert.equal(newCampaign.events[0].props.web_traffic, "production")
  assert.equal(newCampaign.events[0].props.web_utm_source, undefined)
  const expired = load({ storage, now: 31 * 86400000 })
  assert.equal(expired.events[0].props.web_utm_campaign, undefined)
})

test("current tags work without storage; a blocked or unrelated click records no checkout", () => {
  const { events, listeners, plans } = load({ search: "?utm_source=instagram", disabled: true })
  assert.equal(events[0].props.web_utm_source, "instagram")
  listeners.click({ target: plans[0], defaultPrevented: true })
  listeners.auxclick({ target: plans[0], button: 2 })
  assert.equal(events.length, 1)
})
