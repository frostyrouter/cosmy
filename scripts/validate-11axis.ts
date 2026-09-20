#!/usr/bin/env npx tsx
import { readFileSync } from 'node:fs';
import { parseRequestClassification } from '../src/routing/vector.js';

const file = process.argv[2] ?? 'data/router-11axis.jsonl';
const raw = readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
let ok = 0, bad = 0;
let cre: number[] = [], des: number[] = [];
for (const line of raw) {
  try {
    const r = JSON.parse(line);
    parseRequestClassification({ demandVector: r.demandVector, deepReasoningRequired: r.deepReasoningRequired, confidence: r.confidence, classifierMetadata: { provider: 'validate', model: 'validate', classifierVersion: 'v1' } });
    // design != creativity check
    cre.push(r.demandVector.creativity);
    des.push(r.demandVector.designSkill);
    ok++;
  } catch (e) {
    console.error('BAD', (e as Error).message.slice(0,120));
    bad++;
  }
}
const corr = (a:number[], b:number[]) => {
  const ma=a.reduce((x,y)=>x+y,0)/a.length, mb=b.reduce((x,y)=>x+y,0)/b.length;
  const num=a.reduce((s,x,i)=>s+(x-ma)*(b[i]!-mb),0);
  const da=Math.sqrt(a.reduce((s,x)=>s+(x-ma)**2,0)), db=Math.sqrt(b.reduce((s,y)=>s+(y-mb)**2,0));
  return da&&db? num/(da*db):0;
};
console.log(`✓ ${ok}/${raw.length} valid, ${bad} bad — corr(creativity,design)=${corr(cre,des).toFixed(3)} ${corr(cre,des)<0.45? '✓ decoupled':'✗ too correlated'}`);
if (bad) process.exit(1);
