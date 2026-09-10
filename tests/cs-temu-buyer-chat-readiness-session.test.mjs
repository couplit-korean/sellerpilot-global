import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import * as React from "react";

globalThis.React = React;
let values = [];
let cursor = 0;
const cleanups = new Map();

globalThis.__temuBuyerChatHooks = {
  useState(initial) {
    const index = cursor++;
    if (!(index in values)) values[index] = initial;
    return [values[index], value => {
      values[index] = typeof value === "function" ? value(values[index]) : value;
    }];
  },
  useRef(initial) {
    const index = cursor++;
    return values[index] ??= { current: initial };
  },
  useEffect(effect, dependencies) {
    const index = cursor++;
    const prior = values[index];
    const changed = !prior || dependencies.some((value, dependencyIndex) =>
      !Object.is(value, prior[dependencyIndex]));
    if (!changed) return;
    cleanups.get(index)?.();
    values[index] = dependencies;
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.set(index, cleanup);
  },
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && context.parentURL?.endsWith("/temu/buyer-chat-readiness.tsx")) {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export const {useState,useRef,useEffect}=globalThis.__temuBuyerChatHooks",
      };
    }
    return nextResolve(specifier, context);
  },
});

const { TemuBuyerChatReadiness } = await import(
  "../app/cs/channels/temu/buyer-chat-readiness.tsx"
);
const tick = () => new Promise(resolve => setImmediate(resolve));
const credentialId = "00000000-0000-4000-8000-00000000b801";
const newCredentialId = "00000000-0000-4000-8000-00000000b802";

function nodes(value, result = []) {
  if (Array.isArray(value)) value.forEach(item => nodes(item, result));
  else if (value && typeof value === "object") {
    result.push(value);
    nodes(value.props?.children, result);
  }
  return result;
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object") return text(value.props?.children);
  return String(value ?? "");
}

function renderPanel(fetcher) {
  cursor = 0;
  return TemuBuyerChatReadiness({ authenticatedFetch: fetcher });
}

function button(tree, label) {
  return nodes(tree).find(node => node.type === "button" && text(node).includes(label));
}

function deferred() {
  let resolve;
  const promise = new Promise(resolve_ => { resolve = resolve_; });
  return { promise, resolve };
}

function accountsResponse(id, label) {
  return Response.json({
    contract: "sellerpilot-temu-cs-accounts/1",
    checkedAt: new Date().toISOString(),
    accounts: [{
      credentialId: id,
      label,
      environment: "production",
      credentialFingerprint: "abcdef123456",
      sellerAccountKeyHash: "b".repeat(64),
    }],
  });
}

function readyResponse(id) {
  return Response.json({
    contract: "sellerpilot-temu-buyer-chat-readiness-view/1",
    checkedAt: new Date().toISOString(),
    credentialId: id,
    sellerAccountKey: "b".repeat(64),
    environment: "production",
    state: "ready",
    ready: true,
    blockers: [],
    evidenceSource: null,
    providerFetchPerformed: false,
    receive: false,
    history: false,
    reply: false,
    readback: false,
  });
}

test("pending account lookup cannot strand or overwrite a replacement session", async () => {
  values = [];
  cleanups.clear();
  const oldAccounts = deferred();
  const newAccounts = deferred();
  let oldSignal;
  const oldFetch = async (_url, init) => {
    oldSignal = init.signal;
    return oldAccounts.promise;
  };
  const newFetch = async () => newAccounts.promise;

  let tree = renderPanel(oldFetch);
  button(tree, "Temu 계정 불러오기").props.onClick();
  await tick();
  tree = renderPanel(oldFetch);
  assert.equal(button(tree, "확인 중").props.disabled, true);

  tree = renderPanel(newFetch);
  assert.equal(oldSignal.aborted, true);
  assert.equal(button(tree, "Temu 계정 불러오기").props.disabled, false);
  button(tree, "Temu 계정 불러오기").props.onClick();
  await tick();
  tree = renderPanel(newFetch);
  assert.equal(button(tree, "확인 중").props.disabled, true);

  oldAccounts.resolve(accountsResponse(credentialId, "old session"));
  await tick();
  tree = renderPanel(newFetch);
  assert.equal(button(tree, "확인 중").props.disabled, true);
  assert.doesNotMatch(text(tree), /old session/u);

  newAccounts.resolve(accountsResponse(newCredentialId, "new session"));
  await tick();
  tree = renderPanel(newFetch);
  assert.equal(button(tree, "Temu 계정 불러오기").props.disabled, false);
  assert.equal(nodes(tree).find(node => node.type === "select").props.value, newCredentialId);
  assert.match(text(tree), /new session/u);
  assert.doesNotMatch(text(tree), /old session/u);
});

test("pending readiness cannot strand, clear busy, or display data in a replacement session", async () => {
  values = [];
  cleanups.clear();
  const oldReadiness = deferred();
  const newAccounts = deferred();
  let oldSignal;
  const oldFetch = async (url, init) => {
    if (url.includes("view=accounts")) {
      return accountsResponse(credentialId, "old session");
    }
    oldSignal = init.signal;
    return oldReadiness.promise;
  };
  const newFetch = async () => newAccounts.promise;

  let tree = renderPanel(oldFetch);
  button(tree, "Temu 계정 불러오기").props.onClick();
  await tick();
  tree = renderPanel(oldFetch);
  assert.equal(nodes(tree).find(node => node.type === "select").props.value, credentialId);
  button(tree, "Buyer Chat 권한 경계 확인").props.onClick();
  await tick();
  assert.equal(oldSignal.aborted, false);

  tree = renderPanel(newFetch);
  assert.equal(oldSignal.aborted, true);
  assert.equal(button(tree, "Temu 계정 불러오기").props.disabled, false);
  assert.equal(nodes(tree).some(node => node.props?.role === "status"), false);
  button(tree, "Temu 계정 불러오기").props.onClick();
  await tick();
  tree = renderPanel(newFetch);
  assert.equal(button(tree, "확인 중").props.disabled, true);

  oldReadiness.resolve(readyResponse(credentialId));
  await tick();
  tree = renderPanel(newFetch);
  assert.equal(button(tree, "확인 중").props.disabled, true);
  assert.equal(nodes(tree).some(node => node.props?.role === "status"), false);
  assert.doesNotMatch(text(tree), /서버 권한 경계 통과/u);

  newAccounts.resolve(accountsResponse(newCredentialId, "new session"));
  await tick();
  tree = renderPanel(newFetch);
  assert.equal(button(tree, "Temu 계정 불러오기").props.disabled, false);
  assert.equal(nodes(tree).find(node => node.type === "select").props.value, newCredentialId);
  assert.doesNotMatch(text(tree), /서버 권한 경계 통과|old session/u);
});

test("unmount cleanup aborts the current request", async () => {
  values = [];
  cleanups.clear();
  let signal;
  const fetcher = async (_url, init) => {
    signal = init.signal;
    return new Promise(() => {});
  };
  cursor = 0;
  const tree = TemuBuyerChatReadiness({ authenticatedFetch: fetcher });
  nodes(tree).find(node => node.type === "button").props.onClick();
  await tick();
  assert.equal(signal.aborted, false);
  for (const cleanup of cleanups.values()) cleanup();
  assert.equal(signal.aborted, true);
});
