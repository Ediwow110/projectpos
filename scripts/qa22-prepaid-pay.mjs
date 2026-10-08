import { chromium } from "file:///C:/Users/Viruss/.devspace/worktrees/POS-ea43a34e/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs";

const checkoutUrl = process.argv[2];
if (!checkoutUrl) {
  console.error("usage: node scripts/qa22-prepaid-pay.mjs <checkoutUrl>");
  process.exit(1);
}

const readFormStore = (page) =>
  page.evaluate(() => {
    const form = document.querySelector("#checkout-form");
    const fk = Object.keys(form).find((k) => k.startsWith("__reactFiber"));
    let fiber = form[fk];
    let found = null;
    const walk = (node, depth) => {
      if (!node || depth > 30 || found) return;
      let st = node.memoizedState;
      let k = 0;
      while (st && k < 10) {
        const ms = st.memoizedState;
        if (ms && typeof ms === "object" && ms !== null && "values" in ms && typeof ms.values?.email === "string") {
          found = {
            values: ms.values,
            errors: ms.errors,
            isValid: ms.isValid,
          };
          return;
        }
        st = st.next;
        k += 1;
      }
      walk(node.child, depth + 1);
      walk(node.sibling, depth + 1);
    };
    walk(fiber, 0);
    return found;
  });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(4_000);

  await page.locator("#checkout-form button").first().click();
  await page.waitForTimeout(4_000);

  await page.locator('#checkout-form button:has-text("Select a country")').click();
  await page.waitForTimeout(1_200);
  await page.keyboard.type("Philippines", { delay: 40 });
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1_500);

  const typeInto = async (sel, val) => {
    await page.locator(sel).click();
    await page.locator(sel).pressSequentially(val, { delay: 12 });
  };
  await typeInto('#checkout-form input[name="name"]', "QA Browser Pay");
  await typeInto('#checkout-form input[name="email"]', "browserpay22@example.invalid");
  await typeInto('#checkout-form input[name="mobile_phone"]', "09170000004");
  await typeInto('#checkout-form input[name="billing.address.line1"]', "123 QA St");
  await typeInto('#checkout-form input[name="billing.address.city"]', "Quezon City");
  await typeInto('#checkout-form input[name="billing.address.state"]', "Metro Manila");
  await typeInto('#checkout-form input[name="billing.address.postal_code"]', "1100");
  await typeInto('#checkout-form input[name="payment.details.card.number"]', "4343434343434345");
  await typeInto('#checkout-form input[name="payment.details.card.expMonth"]', "12");
  await typeInto('#checkout-form input[name="payment.details.card.expYear"]', "30");
  await typeInto('#checkout-form input[name="payment.details.card.cvc"]', "123");
  await typeInto('#checkout-form input[name="payment.details.card.name"]', "QA Browser Pay");
  // blur the last field so any focus-dependent validation runs
  await page.locator("#checkout-form h2").first().click();
  await page.waitForTimeout(1_500);

  const ctrlState = await page.evaluate(() => {
    const i = document.querySelector('#checkout-form input[name="name"]');
    const fk = Object.keys(i).find((k) => k.startsWith("__reactFiber"));
    let f = i[fk];
    let hops = 0;
    while (f && hops < 40) {
      let st = f.memoizedState;
      let k = 0;
      while (st && k < 15) {
        const ms = st.memoizedState;
        if (ms && typeof ms === "object" && ms !== null) {
          const ctrlKey = Object.keys(ms).find((kk) => ms[kk] && typeof ms[kk] === "object" && ms[kk]._formValues);
          if (ctrlKey) {
            const ctrl = ms[ctrlKey];
            return {
              values: JSON.parse(JSON.stringify(ctrl._formValues)),
              fields: Object.keys(ctrl._fields ?? {}),
            };
          }
        }
        st = st.next;
        k += 1;
      }
      f = f.return;
      hops += 1;
    }
    return null;
  });
  console.log("CTRL STATE:", JSON.stringify({
    country: ctrlState?.values?.billing?.address?.country,
    card: ctrlState?.values?.payment?.details?.card,
    fields: ctrlState?.fields,
  }));
  {
    const flags = await page.evaluate(() => {
      const form = document.querySelector("#checkout-form");
      const fk = Object.keys(form).find((k) => k.startsWith("__reactFiber"));
      let fiber = form[fk];
      let found = null;
      const walk = (node, depth) => {
        if (!node || depth > 35 || found) return;
        let st = node.memoizedState;
        let k = 0;
        while (st && k < 12) {
          const ms = st.memoizedState;
          if (ms && typeof ms === "object" && ms !== null && "values" in ms && typeof ms.values?.email === "string") {
            found = {
              isReady: ms.isReady,
              isValid: ms.isValid,
              isDirty: ms.isDirty,
              touchedCount: Object.keys(ms.touchedFields ?? {}).length,
            };
            return;
          }
          st = st.next;
          k += 1;
        }
        walk(node.child, depth + 1);
        walk(node.sibling, depth + 1);
      };
      walk(fiber, 0);
      return found;
    });
    console.log("FORM FLAGS:", JSON.stringify(flags));
  }

  const payEnabled = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("#checkout-form button"));
    const pay = buttons.find((b) => (b.innerText ?? "").includes("Pay"));
    return pay ? !pay.disabled : false;
  });
  console.log("PAY ENABLED:", payEnabled);
  if (!payEnabled) {
    const flags = await page.evaluate(() => {
      const form = document.querySelector("#checkout-form");
      const fk = Object.keys(form).find((k) => k.startsWith("__reactFiber"));
      let fiber = form[fk];
      let found = null;
      const walk = (node, depth) => {
        if (!node || depth > 35 || found) return;
        let st = node.memoizedState;
        let k = 0;
        while (st && k < 12) {
          const ms = st.memoizedState;
          if (ms && typeof ms === "object" && ms !== null && "values" in ms && typeof ms.values?.email === "string") {
            found = {
              isReady: ms.isReady,
              isValid: ms.isValid,
              isDirty: ms.isDirty,
              disabled: ms.disabled,
              touched: JSON.stringify(ms.touchedFields).slice(0, 120),
            };
            return;
          }
          st = st.next;
          k += 1;
        }
        walk(node.child, depth + 1);
        walk(node.sibling, depth + 1);
      };
      walk(fiber, 0);
      return found;
    });
    console.log("FORM FLAGS:", JSON.stringify(flags));
    const schemaRun = await page.evaluate(() => {
      const form = document.querySelector("#checkout-form");
      const fk = Object.keys(form).find((k) => k.startsWith("__reactFiber"));
      let fiber = form[fk];
      let found = null;
      const walk = (node, depth) => {
        if (!node || depth > 40 || found) return;
        let st = node.memoizedState;
        let k = 0;
        while (st && k < 15) {
          const ms = st.memoizedState;
          if (ms && typeof ms === "object" && ms !== null) {
            const ctrlKey = Object.keys(ms).find((kk) => ms[kk] && typeof ms[kk] === "object" && ms[kk]._runSchema);
            if (ctrlKey) {
              const ctrl = ms[ctrlKey];
              return {
                mode: ctrl._options?.mode,
                resolver: typeof ctrl._options?.resolver === "function",
                formValues: ctrl._formValues,
              };
            }
          }
          st = st.next;
          k += 1;
        }
        walk(node.child, depth + 1);
        walk(node.sibling, depth + 1);
      };
      walk(fiber, 0);
      return found ? JSON.parse(JSON.stringify(found)) : null;
    });
    console.log("SCHEMA RUN:", JSON.stringify(schemaRun, null, 1));
    const ctrlRun = await page.evaluate(() => {
      const i = document.querySelector('#checkout-form input[name="name"]');
      const fk = Object.keys(i).find((k) => k.startsWith("__reactFiber"));
      let f = i[fk];
      let hops = 0;
      while (f && hops < 45) {
        let st = f.memoizedState;
        let k = 0;
        while (st && k < 15) {
          const ms = st.memoizedState;
          if (ms && typeof ms === "object" && ms !== null) {
            const ctrlKey = Object.keys(ms).find((kk) => ms[kk] && typeof ms[kk] === "object" && ms[kk]._runSchema);
            if (ctrlKey) {
              const ctrl = ms[ctrlKey];
              return {
                mode: ctrl._options?.mode,
                resolverType: typeof ctrl._options?.resolver,
                values: JSON.parse(JSON.stringify(ctrl._formValues)),
              };
            }
          }
          st = st.next;
          k += 1;
        }
        f = f.return;
        hops += 1;
      }
      return null;
    });
    console.log("CTRL RUN:", JSON.stringify(ctrlRun, null, 1));
    try {
      const runRes = await page.evaluate(async () => {
      const i = document.querySelector('#checkout-form input[name="name"]');
      const fk = Object.keys(i).find((k) => k.startsWith("__reactFiber"));
      let f = i[fk];
      let hops = 0;
      while (f && hops < 45) {
        let st = f.memoizedState;
        let k = 0;
        while (st && k < 15) {
          const ms = st.memoizedState;
          if (ms && typeof ms === "object" && ms !== null) {
            const ctrlKey = Object.keys(ms).find((kk) => ms[kk] && typeof ms[kk] === "object" && ms[kk]._runSchema);
            if (ctrlKey) {
              const ctrl = ms[ctrlKey];
              let res;
              try {
                res = await ctrl._runSchema(ctrl._formValues, undefined, ctrl._proxyFormState, ctrl._names);
              } catch {
                try {
                  res = await ctrl._runSchema(ctrl._formValues, ctrl._names);
                } catch {
                  res = await ctrl._runSchema(ctrl._formValues);
                }
              }
              return { errors: res.errors };
            }
          }
          st = st.next;
          k += 1;
        }
        f = f.return;
        hops += 1;
      }
      return null;
    });
      console.log("RUN RESULT:", JSON.stringify(runRes, null, 1));
    } catch (e) {
      console.log("RUN RESULT: threw -", e.message.slice(0, 100));
    }
    const triggerCheck = await page.evaluate(async () => {
      const i = document.querySelector('#checkout-form input[name="name"]');
      const fk = Object.keys(i).find((k) => k.startsWith("__reactFiber"));
      let f = i[fk];
      let hops = 0;
      while (f && hops < 45) {
        let st = f.memoizedState;
        let k = 0;
        while (st && k < 15) {
          const ms = st.memoizedState;
          if (ms && typeof ms === "object" && ms !== null) {
            const ctrlKey = Object.keys(ms).find((kk) => ms[kk] && typeof ms[kk] === "object" && ms[kk]._runSchema);
            if (ctrlKey) {
              const ctrl = ms[ctrlKey];
              const ok = typeof ctrl.trigger === "function" ? await ctrl.trigger() : "no-trigger-fn";
              const fields = ["name", "email", "mobile_phone", "billing.address.line1", "billing.address.city", "billing.address.state", "billing.address.postal_code", "payment.details.card.number", "payment.details.card.expMonth", "payment.details.card.expYear", "payment.details.card.cvc", "payment.details.card.name"];
              const report = {};
              for (const fld of fields) {
                try {
                  const st2 = ctrl.getFieldState(fld);
                  if (st2.error) report[fld] = st2.error.message ?? String(st2.error.type);
                } catch {}
              }
              return { triggerOk: ok, errors: report };
            }
          }
          st = st.next;
          k += 1;
        }
        f = f.return;
        hops += 1;
      }
      return null;
    });
    console.log("TRIGGER CHECK:", JSON.stringify(triggerCheck, null, 1));
    const resolverTest = await page.evaluate(async () => {
      const i = document.querySelector('#checkout-form input[name="name"]');
      const fk = Object.keys(i).find((k) => k.startsWith("__reactFiber"));
      let f = i[fk];
      let hops = 0;
      while (f && hops < 45) {
        let st = f.memoizedState;
        let k = 0;
        while (st && k < 15) {
          const ms = st.memoizedState;
          if (ms && typeof ms === "object" && ms !== null) {
            const ctrlKey = Object.keys(ms).find((kk) => ms[kk] && typeof ms[kk] === "object" && ms[kk]._runSchema);
            if (ctrlKey) {
              const ctrl = ms[ctrlKey];
              const resolver = ctrl._options?.resolver;
              if (resolver) {
                let res;
                try {
                  res = await resolver(ctrl._formValues, undefined, { names: ctrl._names });
                  return { errors: res.errors };
                } catch {
                  res = await resolver(ctrl._formValues, undefined, { fields: {} });
                  return { errors2: res.errors };
                }
              }
              return { noResolver: true };
            }
          }
          st = st.next;
          k += 1;
        }
        f = f.return;
        hops += 1;
      }
      return null;
    });
    console.log("RESOLVER TEST:", JSON.stringify(resolverTest, null, 1));
    const payTypes = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("#checkout-form button"));
      const pay = buttons.find((b) => (b.innerText ?? "").includes("Pay"));
      const fk = Object.keys(pay).find((k) => k.startsWith("__reactFiber"));
      let fiber = pay[fk];
      let hops = 0;
      const types = [];
      while (fiber && hops < 12) {
        types.push(typeof fiber.type === "function" ? (fiber.type.name || "fn") : String(fiber.type).slice(0, 25));
        fiber = fiber.return;
        hops += 1;
      }
      return types;
    });
    console.log("PAY FIBER TYPES:", JSON.stringify(payTypes));
  }
  if (!payEnabled) {
    const cardHandlers = await page.evaluate(() => {
      const i = document.querySelector('#checkout-form input[name="payment.details.card.number"]');
      const fk = Object.keys(i).find((k) => k.startsWith("__reactFiber"));
      let f = i[fk];
      let hops = 0;
      const out = [];
      while (f && hops < 15) {
        const p = f.memoizedProps;
        if (p && typeof p === "object" && typeof p.onChange === "function") {
          out.push({ hop: hops, onChangeSrc: String(p.onChange).slice(0, 300) });
        }
        f = f.return;
        hops += 1;
      }
      return out;
    });
    console.log("CARD HANDLERS:", JSON.stringify(cardHandlers, null, 1));
    const disabledWhy = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("#checkout-form button"));
      const pay = buttons.find((b) => (b.innerText ?? "").includes("Pay"));
      const fk = Object.keys(pay).find((k) => k.startsWith("__reactFiber"));
      let fiber = pay[fk];
      let hops = 0;
      const out = [];
      while (fiber && hops < 20) {
        const p = fiber.memoizedProps;
        if (p && typeof p === "object" && "disabled" in p) {
          out.push({ hop: hops, disabled: p.disabled });
        }
        let st = fiber.memoizedState;
        let k = 0;
        while (st && k < 8) {
          const ms = st.memoizedState;
          if (ms && typeof ms === "object" && ms !== null) {
            const interesting = Object.keys(ms).filter((key) => /^(cardComplete|cardValid|paymentValid|ready|canPay|errors)$/i.test(key));
            if (interesting.length) out.push({ hop: hops, stateKeys: interesting, values: interesting.map((key) => JSON.stringify(ms[key]).slice(0, 80)) });
          }
          st = st.next;
          k += 1;
        }
        fiber = fiber.return;
        hops += 1;
      }
      return out;
    });
    console.log("DISABLE WHY:", JSON.stringify(disabledWhy));
  }

  if (payEnabled) {
    await page.locator("#checkout-form button[name=submit]").click();
    for (let i = 0; i < 8; i += 1) {
      await page.waitForTimeout(3_000);
      const url = page.url();
      const frames = page.frames().map((f) => f.url());
      console.log(`TICK ${i}: ${url} frames=${JSON.stringify(frames)}`);
      if (url.includes("order-status") || frames.some((f) => /acs|3ds|auth/i.test(f))) break;
    }
    const body = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log("FINAL:", page.url(), body.replace(/\s+/g, " ").slice(0, 300));
} else if (process.argv[3] === "--state-check") {
    const domCheck = await page.evaluate(() => {
      const state = document.querySelector('#checkout-form input[name="billing.address.state"]');
      return {
        stateValue: state?.value,
        stateVisible: state ? state.offsetParent !== null : null,
        stateDisabled: state?.disabled,
      };
    });
    console.log("STATE FIELD:", JSON.stringify(domCheck));
  } else if (process.argv[3] === "--force-pay") {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("#checkout-form button"));
      const pay = buttons.find((b) => (b.innerText ?? "").includes("Pay"));
      const pk = Object.keys(pay).find((k) => k.startsWith("__reactProps"));
      const p = pay[pk];
      if (typeof p.onClick !== "function") return "no onClick prop";
      p.onClick({ preventDefault() {} });
      return "invoked onClick directly";
    });
    console.log("FORCED CLICK:", clicked);
    await page.waitForTimeout(10_000);
    console.log("URL AFTER FORCE:", page.url());
    const body2 = await page.evaluate(() => document.body.innerText.slice(0, 400));
    console.log("BODY AFTER FORCE:", body2.replace(/\s+/g, " ").slice(0, 250));
  }
} catch (error) {
  console.log("ERROR:", error.message);
} finally {
  await browser.close();
}
