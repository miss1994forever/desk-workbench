import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { extname } from 'node:path';
registerHooks({resolve(s,c,n){return n(s.startsWith('.')&&!extname(s)&&c.parentURL?.endsWith('.ts')?s+'.ts':s,c);}});
const {FILM_DAYS,FILM_CHAPTERS,FILM_SEASON,filmForDay,filmImageForCard}=await import('../lib/film-season.ts');
test('the full editorial calendar preserves 59 date IDs and offers sourced stories rather than viewing exercises',()=>{
 assert.equal(FILM_DAYS.length,59);assert.equal(new Set(FILM_DAYS.map(c=>c.id)).size,59);
 FILM_DAYS.forEach((card,index)=>{
  const date=new Date(Date.parse(FILM_SEASON.from+'T00:00:00Z')+index*86400000).toISOString().slice(0,10);
  assert.equal(card.date,date);assert.equal(card.id,'film-'+date.replaceAll('-',''));
  assert.equal(card.kind,'fact');assert(card.film_title&&card.topic&&card.post_note);
  assert.equal(new URL(card.source_url).protocol,'https:');assert(!/原创观看|凭记忆想象|闭一下眼睛/.test(card.text));
  assert.equal(filmForDay(date).card.id,card.id);
 });
 assert.equal(FILM_DAYS.at(-1).date,FILM_SEASON.through);assert.equal(FILM_CHAPTERS.length,9);
 assert.equal(filmForDay('2026-10-18'),null);assert.equal(filmForDay('2026-12-17'),null);
});
test('mixed-film chapters never borrow an unrelated character image',()=>{
 const byFilm=name=>FILM_DAYS.find(c=>c.film_title===name);
 assert.match(filmImageForCard(byFilm('沙丘')).source_url,/dune/);
 assert.equal(filmImageForCard(byFilm('银翼杀手2049')),null);
 assert.equal(filmImageForCard(byFilm('银河护卫队3')),null);
 assert.equal(filmImageForCard(byFilm('洛基 第二季')),null);
 assert.match(filmImageForCard(byFilm('钢铁侠')).source_url,/\/iron-man\/$/);
 assert.match(filmImageForCard(byFilm('复仇者联盟4：终局之战')).source_url,/avengers-endgame/);
 assert.equal(FILM_DAYS.filter(c=>c.film_title==='雷神3：诸神黄昏').length,4);
 assert(new Set(FILM_DAYS.map(c=>c.film_title)).size>=15);
});
