import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {extname} from 'node:path';
registerHooks({resolve(s,c,n){return n(s.startsWith('.')&&!extname(s)&&c.parentURL?.endsWith('.ts')?s+'.ts':s,c);}});
const {admissionsQueue}=await import('../lib/admissions-queue.ts');
const {recommendNext,categoryTarget}=await import('../lib/next-action.ts');
const {ADMISSIONS_SOURCE_URL}=await import('../lib/admissions-tasks.ts');
const parent=(id,status='Not Started',priority='P1')=>({id,content:{kind:'admissions_work',domain:'admissions',title:id},facts:[],admissions_task:{record_id:'rec'+id,title:id,source_status:status,category:'SOP/PS',priority,next_action:'推进真实交付',internal_due_date:'2020-01-01',due:{at:'2020-01-01',kind:'source_plan'},source_url:ADMISSIONS_SOURCE_URL,source_modified_at:null,source_revision:1,observed_at:'2026-10-19T00:00:00Z',source_present:true}});
test('application queue folds source waiting and supporting forms and never treats internal dates as hard deadlines',()=>{
 const support={id:'support',content:{title:'局部素材',domain:'admissions'},facts:[],supports_task_record_id:'recactive'};
 const waiting=parent('waiting','Waiting','P0'),low=parent('low','Not Started','P2'),active=parent('active'),archive=parent('archive','Done');
 const rows=[support,waiting,low,active,archive],queue=admissionsQueue(rows);
 assert.deepEqual(queue.active.map(p=>p.id),['active','low']);assert.deepEqual(queue.waiting.map(p=>p.id),['waiting']);assert.deepEqual(queue.sourceArchive.map(p=>p.id),['archive']);assert.deepEqual(queue.support.map(p=>p.id),['support']);
 assert.equal(recommendNext(rows,undefined,new Date('2026-10-19T05:00:00Z')).pkg.id,'active');
 assert.equal(categoryTarget(rows,'admissions')?.id,'active');assert.equal(categoryTarget(rows,'admissions',undefined,'waiting')?.id,'waiting');
 assert.equal(recommendNext([waiting,archive],undefined,new Date('2026-10-19T05:00:00Z')),null);
});
