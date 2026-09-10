import assert from "node:assert/strict";
import test from "node:test";
import { conversationMediaLinks } from "../lib/cs/conversation-media";

test("conversation media exposes only bounded credential-free HTTPS links",()=>{
 const links=conversationMediaLinks({image_info:[
  {image_url:"https://example.test/review.jpg"},
  {image_url:"https://user:secret@example.test/private.jpg"},
 ],video_info:{video_url:"javascript:alert(1)"},attachment_url:"https://example.test/manual.pdf"});
 assert.deepEqual(links,[
  {url:"https://example.test/review.jpg",label:"image url",kind:"image",availability:"expiry_unknown",expiresAt:null,retention:"provider_url_only",recovery:"provider_url_unrecoverable"},
  {url:"https://example.test/manual.pdf",label:"attachment url",kind:"file",availability:"expiry_unknown",expiresAt:null,retention:"provider_url_only",recovery:"provider_url_unrecoverable"},
 ]);
});

test("conversation media distinguishes active, expired and unknown signed URLs",()=>{
 const now=new Date("2026-09-08T00:00:00.000Z");
 const links=conversationMediaLinks({
  expired:"https://files.example.test/a.jpg?Expires=1788739200",
  active:"https://files.example.test/b.jpg?X-Amz-Date=20260908T000000Z&X-Amz-Expires=600",
  unknown:"https://files.example.test/c.jpg?signature=opaque",
 },now);
 assert.equal(links[0].availability,"expired");
 assert.equal(links[0].recovery,"refresh_channel_history");
 assert.equal(links[1].availability,"available");
 assert.equal(links[1].expiresAt,"2026-09-08T00:10:00.000Z");
 assert.equal(links[2].availability,"expiry_unknown");
});

test("conversation media bounds recursive provider envelopes",()=>{
 const media=Object.fromEntries(Array.from({length:30},(_,index)=>[`image_${index}`,`https://example.test/${index}.jpg`]));
 assert.equal(conversationMediaLinks(media).length,20);
 assert.deepEqual(conversationMediaLinks(null),[]);
});
