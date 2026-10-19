import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { extname } from "node:path";
registerHooks({ resolve(s,c,n) { return n(s.startsWith('.')&&!extname(s)&&c.parentURL?.endsWith('.ts')?s+'.ts':s,c); } });
const { recommendNext, beijingDate, todaysSlots, categoryTarget } = await import('../lib/next-action.ts');
const pkg = (id,domain='academics',other={})=>({id,content:{kind:'guided_work',title:id,domain},facts:[],...other});
const plan = { date:'2026-10-19',items:[{id:'a',package_id:'iot',date:'2026-10-19',start:'10:05',end:'10:25',kind:'suggested'},{id:'b',package_id:'motion',date:'2026-10-19',start:'10:40',end:'11:15',kind:'suggested'},{id:'c',package_id:'iot',date:'2026-10-20',start:'10:00',end:'10:30',kind:'suggested'}]};
const packages=[pkg('education','admissions',{task_completion:{status:'completed'}}),pkg('chi','admissions'),pkg('iot'),pkg('motion','research')];
test('top recommendation is independent of category or inspected current task and never recommends completed work',()=>{
 const date=new Date('2026-10-19T01:20:00Z');
 assert.equal(recommendNext(packages,plan,date).pkg.id,'iot');
 assert.equal(recommendNext(packages,plan,date).label,'接下来的安排');
 assert.equal(recommendNext(packages,plan,date).timeLabel,'10:05–10:25');
 const done=structuredClone(packages);done[2].task_completion={status:'completed'};
 assert.equal(recommendNext(done,plan,date).pkg.id,'motion');
 assert.equal(recommendNext(done.map(p=>({...p,task_completion:{status:'completed'}})),plan,date),null);
});
test('active slots follow Beijing time, and midnight uses dated items rather than stale outer plan date',()=>{
 assert.equal(recommendNext(packages,plan,new Date('2026-10-19T02:10:00Z')).kind,'current_slot');
 assert.equal(recommendNext(packages,plan,new Date('2026-10-19T02:45:00Z')).pkg.id,'motion');
 assert.equal(beijingDate(new Date('2026-10-19T16:01:00Z')),'2026-10-20');
 assert.equal(todaysSlots(packages,plan,new Date('2026-10-19T16:01:00Z')).length,1);
 assert.equal(recommendNext(packages,plan,new Date('2026-10-19T16:01:00Z')).pkg.id,'iot');
});
test('only verified exact deadlines affect urgency; an old platform todo never proves non-submission',()=>{
 const unknown=pkg('guess','research');unknown.content.due={kind:'uncommitted_candidate',at:'2026-10-18T00:00:00Z'};
 const hard=pkg('deadline');hard.content.due={kind:'platform_deadline',at:'2026-10-19T04:00:00Z'};
 const a=recommendNext([unknown,...packages,hard],plan,new Date('2026-10-19T01:20:00Z'));
 assert.equal(a.pkg.id,'deadline');assert.equal(a.kind,'deadline');
 assert.match(recommendNext([hard],undefined,new Date('2026-10-20T01:00:00Z')).label,/先核实际状态/);
});
test('a clock without an explicit timezone cannot manufacture an urgent deadline or a valid plan slot',()=>{
 const unknown=pkg('unknown','research');unknown.content.due={kind:'platform_deadline',at:'2026-10-19T10:00:00'};
 assert.equal(recommendNext([unknown,pkg('chi','admissions')],undefined,new Date('2026-10-19T01:20:00Z')).pkg.id,'chi');
 const invalid={date:'2026-10-19',items:[{id:'bad',package_id:'unknown',date:'2026-10-19',start:'2026-10-19T10:00:00',end:'2026-10-19T11:00:00',kind:'suggested'}]};
 assert.notEqual(recommendNext([unknown],invalid,new Date('2026-10-19T02:30:00Z')).kind,'current_slot');
});
test('without a usable slot, saved work resumes before untouched application work; a candidate date is not a hard deadline',()=>{
 const started=pkg('started','research',{work:{status:'in_progress',answers:{a:{text:'saved'}}}});
 assert.equal(recommendNext([...packages,started],undefined,new Date('2026-10-19T01:20:00Z')).pkg.id,'started');
 assert.equal(recommendNext(packages,undefined,new Date('2026-10-19T01:20:00Z')).pkg.id,'chi');
});
test('category selection stays inside its domain, remembers unfinished work and falls back to a completed archive only when all are done',()=>{
 assert.equal(categoryTarget(packages,'research','iot')?.id,'motion');
 assert.equal(categoryTarget(packages,'admissions','iot','education')?.id,'chi');
 assert.equal(categoryTarget(packages,'empty','iot'),null);
 const second=pkg('second','research');assert.equal(categoryTarget([...packages,second],'research','motion','second')?.id,'second');
 assert.equal(categoryTarget([packages[0]],'admissions')?.id,'education');
});
test('real academic sources drive names, deadlines and category choice instead of a legacy check goal',async()=>{
 const {taskTitle}=await import('../lib/work-label.ts');
 const sourced=(id,kind,due)=>({...pkg(id),academic_task:{id:'source:'+id,kind,title:'实际交付 '+id,course_name:'课程',deliverables:['完成实际交付'],sources:[{id:'school',title:'学校要求',url:'https://courses.example.edu/'}],source_refs:['school'],source_revision:1,sourced_at:'2026-10-19T00:00:00Z',due}});
 const study=sourced('study','study',{at:null,kind:'none_verified'});study.content.due={at:'2026-10-01T00:00:00Z',kind:'platform_deadline'};
 const assignment=sourced('real','assignment',{at:'2026-10-19T04:00:00Z',kind:'platform_deadline',source_id:'school'});assignment.task_completion={status:'completed',note:'旧核状态目标完成'};
 assert.equal(taskTitle(assignment),'实际交付 real');assert.equal(categoryTarget([study,assignment],'academics').id,'real');assert.equal(recommendNext([study,assignment],undefined,new Date('2026-10-19T01:20:00Z')).pkg.id,'real');assert.equal(recommendNext([study],undefined,new Date('2026-10-19T01:20:00Z')).kind,'available');
});
