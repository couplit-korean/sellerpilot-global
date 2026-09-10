import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import * as React from 'react';
globalThis.React = React;
let values = [], cursor = 0;
globalThis.__elevenstHooks = {
  useState(initial) {
    const index = cursor++;
    if (!(index in values)) values[index] = initial;
    return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value; }];
  },
  useRef(initial) { const index = cursor++; return values[index] ??= {current: initial}; },
  useEffect() {},
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react' && context.parentURL?.endsWith('/elevenst/read-state.tsx')) {
      return {shortCircuit: true, url: 'data:text/javascript,export const {useState,useRef,useEffect}=globalThis.__elevenstHooks'};
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.css')) return {shortCircuit:true, format:'module', source:'export default {}'};
    return next(url, context);
  },
});
const { ElevenstReadStatePanel } = await import('../app/cs/channels/elevenst/read-state.tsx');
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(node, type) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, type); if (result) return result; }
  return null;
}
test('account switch aborts in-flight old account and ignores its late failure', async () => {
  values = [];
  const a = '33333333-3333-4333-8333-333333333333', b = '44444444-4444-4444-8444-444444444444';
  let finish, signal;
  const authenticatedFetch = async (url, options) => {
    if (url.includes('view=accounts')) return {ok:true,json:async()=>({
      contractVersion:'sellerpilot-elevenst-authenticated-accounts/1',
      accounts:[a,b].map((id,index)=>({credentialId:id,sellerId:`account_${index}`,sellerName:`계정 ${index}`,label:`계정 ${index}`,environment:'production',version:1,verifiedAt:'2026-09-09T12:00:00Z'})),
    })};
    signal = options.signal;
    return new Promise(resolve => {finish = () => resolve({ok:false,status:503});});
  };
  const render = () => {cursor=0;return ElevenstReadStatePanel({authenticatedFetch});};
  let tree = render(); tree.props.onToggle({currentTarget:{open:true}}); await tick();
  tree = render(); assert.equal(find(tree,'select').props.value,a);
  find(tree,'button').props.onClick(); await tick(); assert.equal(signal.aborted,false);
  tree = render(); find(tree,'select').props.onChange({currentTarget:{value:b}});
  assert.equal(signal.aborted,true);
  finish(); await tick(); tree = render();
  assert.equal(find(tree,'select').props.value,b);
  assert.equal(find(tree,'button').props.disabled,false);
  assert.equal(values[5],'');
  assert.equal(values[3],null);
});
