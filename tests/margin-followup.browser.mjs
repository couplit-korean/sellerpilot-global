import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

// Mount the actual React component; only authentication and remote responses are fixtures.
test('margin UI resets product costs, expires FX and handles uncertain save/delete without retries', { timeout: 90000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const entry = 'virtual:margin-followup';
  const result = await build({
    configFile: false, root, logLevel: 'error',
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env': '{}' },
    plugins: [react(), { name: 'margin-fixture', enforce: 'pre', resolveId(id) {
      if (id === entry || id.endsWith('/' + entry)) return '\0' + entry;
      if (/lib\/supabase\/client(?:\.ts)?$/.test(id)) return '\0auth-fixture';
    }, load(id) {
      if (id === '\0auth-fixture') return 'export const createClient=()=>({auth:{getSession:async()=>({data:{session:{access_token:"local-test-token"}}})}});';
      if (id === '\0' + entry) return `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {MarginCalculatorPage} from ${JSON.stringify(root + 'app/margin-calculator.tsx')};
        const props={notify:message=>{window.messages.push(message)},onChanged:()=>{window.refreshes++},scenarioState:'ready',scenarioMessage:null,
          scenarios:[{id:'saved-one',productId:'a',name:'라면',channelKey:'qoo10',inputs:{sellingPrice:50000},result:{profit:15000,margin:30},createdAt:new Date().toISOString()}],
          products:[{id:'a',name:'라면',sku:'A',baseCurrency:'KRW',baseSellingPrice:50000},{id:'b',name:'건기식',sku:'B',baseCurrency:'KRW',baseSellingPrice:90000},{id:'c',name:'의류',sku:'C',baseCurrency:'USD',baseSellingPrice:30}]};
        window.messages=[];window.refreshes=0;
        createRoot(document.getElementById('root')).render(React.createElement(MarginCalculatorPage,props));`;
    } }],
    build: { write: false, lib: { entry, name: 'MarginFixture', formats: ['iife'] }, minify: false },
  });
  const code = (Array.isArray(result) ? result[0] : result).output.find(o => o.type === 'chunk').code;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    await page.clock.install({ time: new Date('2026-09-08T12:00:00Z') });
    let ratesFail = false;
    let writes = 0;
    await page.route('http://margin.local/**', async route => {
      const url = route.request().url();
      if (url.endsWith('/api/exchange-rates')) {
        if (ratesFail) return route.fulfill({ status: 502, body: '{}' });
        return route.fulfill({ json: { source: 'local fixture', frequency: 'minute-market', fetchedAt: '2026-09-08T12:00:00Z', asOf: '2026-09-08T12:00:00Z', rates: [{code:'USD',unit:1,value:1400},{code:'JPY',unit:100,value:900},{code:'SGD',unit:1,value:1100},{code:'MYR',unit:1,value:350}] } });
      }
      if (url.endsWith('/api/operations/snapshot')) { writes++; return; }
      return route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><div id="root"></div><script>${code.replaceAll('</script','<\\/script')}</script>` });
    });
    const errors=[]; page.on('pageerror',error=>{errors.push(error.message); console.error(error.message);});
    await page.goto('http://margin.local/');
    await page.locator('#margin-product-id').selectOption('a');
    await page.locator('#purchase-cost').fill('20000');
    await page.locator('#international-shipping').fill('5000');
    await page.locator('#local-shipping').fill('2000');
    await page.getByRole('tab',{name:/eBay/}).click();
    assert.equal(await page.locator('#international-shipping').inputValue(),'0');
    await page.getByRole('tab',{name:/Qoo10/}).click();
    assert.equal(await page.locator('#international-shipping').inputValue(),'5000');
    await page.locator('#margin-product-id').selectOption('b');
    assert.equal(await page.locator('#purchase-cost').inputValue(),'0');
    assert.equal(await page.locator('#international-shipping').inputValue(),'0');
    assert.equal(await page.locator('#selling-price').inputValue(),'90000');
    await page.locator('#margin-product-id').selectOption('c');
    assert.equal(await page.locator('#selling-price').inputValue(),'0');
    await page.locator('#selling-price').fill('50000');
    await page.locator('#purchase-cost').fill('20000');
    ratesFail = true;
    await page.clock.fastForward(301000);
    await page.clock.runFor(1100);
    assert.equal(await page.locator('.margin-profit-value strong').innerText(),'—');
    assert.equal(await page.locator('.margin-result-head em').innerText(),'계산 기준 확인 필요');
    assert.equal(await page.getByRole('button',{name:'계산 결과 저장'}).isDisabled(),true);
    await page.getByRole('tab',{name:/SmartStore|스마트스토어|네이버/}).click();
    await page.getByRole('button',{name:'계산 결과 저장'}).click();
    await page.waitForFunction(()=>document.querySelector('button') && window.messages.length>0);
    // Let token resolution dispatch the request before advancing its deadline.
    await page.waitForTimeout(100);
    await page.clock.fastForward(16000);
    await page.clock.runFor(100);
    await page.getByRole('button',{name:'계산 이력 새로 조회'}).waitFor();
    assert.equal(writes,1);
    assert.equal(await page.getByRole('button',{name:'계산 결과 저장'}).isDisabled(),true);
    assert.ok(await page.evaluate(()=>window.refreshes)>0);
    assert.equal(await page.getByRole('button',{name:'라면 계산 삭제 확인'}).isDisabled(),true);
    await page.reload();
    await page.getByRole('button',{name:'라면 계산 삭제 확인'}).click();
    await page.getByRole('button',{name:'확인 후 삭제'}).click();
    await page.waitForTimeout(100);
    await page.clock.fastForward(16000);
    await page.clock.runFor(100);
    await page.getByRole('button',{name:'계산 이력 새로 조회'}).waitFor();
    assert.equal(writes,2);
    assert.equal(await page.getByRole('button',{name:'라면 계산 삭제 확인'}).isDisabled(),true);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});
