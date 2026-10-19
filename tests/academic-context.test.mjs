import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {extname} from 'node:path';
registerHooks({resolve(s,c,n){return n(s.startsWith('.')&&!extname(s)&&c.parentURL?.endsWith('.ts')?s+'.ts':s,c)}});
const {academicHistory,academicDeadline}=await import('../lib/academic-context.ts');
const pkg={id:'course',content:{kind:'guided_work',domain:'academics',title:'核对实验进度',deliverable:'当前状态、缺口与下一步',guide_steps:[{id:'a',title:'核对',body:'prepared'}],fields:[],sources:[{id:'ppt',document_title:'lecture.pdf',path:'/workspace/examples/lecture.pdf',limitations:'图表需用原文件'}],due:{at:'2026-10-21T16:00:00Z',kind:'platform_deadline'}},work:{answers:{a:{event_id:'old',text:'旧的原话',saved_at:'2026-10-18T10:00:00Z'}}},progress_notes:[{event_id:'new',text:'仅记录：基线已跑，报告未交',saved_at:'2026-10-19T01:00:00Z',saved_by:'owner',basis:'owner_report'}]};
test('latest history preserves owner text without turning records into assignment completion',()=>{
 assert.equal(academicHistory(pkg)[0].id,'new');assert.match(academicHistory(pkg)[0].text,/报告未交/);
});
test('midnight deadline is shown in Beijing time with previous night; unverifiable dates stay unknown',()=>{
 assert.match(academicDeadline(pkg),/10月22日.*00:00.*10月21日/);const copy=structuredClone(pkg);copy.content.due.kind='candidate';assert.match(academicDeadline(copy),/未核验/);copy.content.due.kind='platform_deadline';copy.content.due.at='bad';assert.match(academicDeadline(copy),/未核验/);
});
test('legacy session summaries and answers remain available, absence of notes never implies no work done',()=>{
 const copy=structuredClone(pkg);delete copy.progress_notes;copy.work.finish_summary='已有小结';copy.work.finished_at='2026-10-19T02:00:00Z';assert.equal(academicHistory(copy)[0].text,'已有小结');copy.work={answers:{},finish_history:[{summary:'被归档的原话',event_id:'archive',finished_at:'2026-10-18T00:00:00Z'}]};assert.equal(academicHistory(copy)[0].text,'被归档的原话');copy.work={answers:{}};assert.deepEqual(academicHistory(copy),[]);
});
