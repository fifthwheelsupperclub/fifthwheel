import assert from 'node:assert/strict';
import test from 'node:test';
import {captureAttribution,captureTestMode,shouldTrackLead} from './attribution.ts';
const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},removeItem:(k:string)=>{m.delete(k);}};};
const now=Date.parse('2026-11-08T18:00:00Z');
test('tagged campaign survives direct return; new touch does not retain prior ad',()=>{
 const s=memory();const first=captureAttribution(new URL('https://fifthwheel.community/?campaign_id=123&ad_id=456&utm_source=ig&email=private'), 'https://instagram.com/',s,now);
 assert.equal(first.ad_id,'456');assert.equal('email' in first,false);
 assert.equal(captureAttribution(new URL('https://fifthwheel.community/'),'',s,now+1000).ad_id,'456');
 assert.equal(captureAttribution(new URL('https://fifthwheel.community/?utm_source=newsletter'),'',s,now+2000).ad_id,undefined);
});
test('expired or corrupt storage is ignored; blocked storage preserves current tags',()=>{
 const s=memory();captureAttribution(new URL('https://fifthwheel.community/?ad_id=456'),'',s,now);
 assert.deepEqual(captureAttribution(new URL('https://fifthwheel.community/'),'',s,now+31*86400000),{});
 const blocked={getItem(){throw Error();},setItem(){throw Error();},removeItem(){throw Error();}};
 assert.equal(captureAttribution(new URL('https://fifthwheel.community/?campaign_id=123'),'',blocked,now).campaign_id,'123');
});
test('unresolved macros are not captured',()=>{assert.deepEqual(captureAttribution(new URL('https://fifthwheel.community/?ad_id={{ad.id}}'),'',undefined,now),{});});
test('test mode persists for session and can be cleared',()=>{
 const s=memory();assert.equal(captureTestMode(new URL('https://fifthwheel.community/?fw_test=1'),s),true);
 assert.equal(captureTestMode(new URL('https://fifthwheel.community/'),s),true);
 assert.equal(captureTestMode(new URL('https://fifthwheel.community/?fw_test=0'),s),false);
});
test('only explicit server instruction counts a Lead; duplicates/tests/old responses do not',()=>{
 for(const body of [null,{}, {ok:true},{track_lead:false},{track_lead:'true'}]) assert.equal(shouldTrackLead(body),false);
 assert.equal(shouldTrackLead({created:true,is_test:false,track_lead:true}),true);
});
