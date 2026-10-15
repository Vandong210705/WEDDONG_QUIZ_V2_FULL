// Deterministic backend logic test: mock database & MQTT, no external services needed.
const assert = require('node:assert/strict');
const Module = require('node:module');
const EventEmitter = require('node:events');

let rows = new Map();
let locked = new Set();
const questions = [
  {id:1,session_id:101,content:'Question one',answer_a:'x',answer_b:'y',answer_c:'z',answer_d:'w',correct_answer:'B'},
  {id:2,session_id:101,content:'Question two',answer_a:'x',answer_b:'y',answer_c:'z',answer_d:'w',correct_answer:'A'}
];
const published=[];
const fakeMqtt = new EventEmitter();
fakeMqtt.connected = true;
fakeMqtt.publish = (topic,msg)=>published.push({topic,data:JSON.parse(msg)});
fakeMqtt.subscribe =()=>{};
fakeMqtt.end =()=>{};
const query = async (sql,args=[]) => {
  const text=sql.trim().replace(/\s+/g,' ').toLowerCase();
  if(text.startsWith('create table'))return [{affectedRows:0}];
  if(text.includes('from quiz_live_rounds r join questions'))return [[]];
  if(text.includes('from questions where id'))return [[questions.find(q=>q.id===args[0])].filter(Boolean)];
  if(text.includes('from quiz_locked_questions'))return [[...locked].filter(x=>x===`${args[0]}:${args[1]}`).map(question_id=>({question_id}))];
  if(text.startsWith('insert into quiz_live_rounds'))return [{affectedRows:1}];
  if(text.startsWith('insert into quiz_responses')){
    const [session_id,question_index,source,participant_key,player_name,answer]=args;
    const key=[session_id,question_index,source,participant_key].join(':');
    rows.set(key,{session_id,question_index,source,participant_key,player_name,answer,is_locked:0,is_correct:null});return [{affectedRows:1}];
  }
  if(text.startsWith('update quiz_responses')){
    const [correct,session_id,question_index]=args;
    for(const r of rows.values())if(r.session_id===session_id&&r.question_index===question_index&&!r.is_locked){r.is_locked=1;r.is_correct=r.answer===correct?1:0;}
    return [{affectedRows:rows.size}];
  }
  if(text.startsWith('update quiz_live_rounds'))return [{affectedRows:1}];
  if(text.startsWith('insert ignore into quiz_locked_questions')){locked.add(`${args[0]}:${args[1]}`);return [{affectedRows:1}];}
  if(text.includes('from quiz_responses where session_id')){
    return [[...rows.values()].filter(r=>r.session_id===args[0]&&r.question_index===args[1]&&r.is_locked)];
  }
  if(text.startsWith('select stt, full_name'))return [[{stt:1,full_name:'Test User',dob:'01/01/2005'}]];
  throw Error('Mock missing SQL: '+sql);
};
const fakeDb={query,getConnection:async()=>({query,beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{}})};
const original=Module._load;
Module._load=function(request,parent,isMain){
  if(request==='mysql2/promise')return {createPool:()=>fakeDb};
  if(request==='mqtt')return {connect:()=>fakeMqtt};
  return original.apply(this,arguments);
};
const api=require('./server');
Module._load=original;

(async()=>{
  await api.setupSchema();
  assert.equal((await api.handleOpen({questionData:{id:1},questionIndex:0})).success,true);
  await new Promise(resolve=>api.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${api.server.address().port}`;
  const current=await fetch(base+'/api/round/current').then(r=>r.json());
  assert.equal(current.state.questionData.correct_answer,undefined,'Before CHỐT, public screen must not receive answer key');
  const unauth=await fetch(base+'/api/questions?session_id=101');
  assert.equal(unauth.status,401,'Question bank must require admin authorization');
  const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:process.env.ADMIN_PASSWORD||'123'})}).then(r=>r.json());
  assert.equal(login.success,true,'Backend admin login must work');
  assert.equal(typeof login.token,'string');
  const trySkip=await api.handleOpen({questionData:{id:2},questionIndex:1});
  assert.equal(trySkip.success,false,'Cannot skip previous question without CHỐT');
  const first=await api.acceptAnswer({sessionId:101,questionIndex:0,source:'HARDWARE',participantKey:'1',playerName:'Test User',answer:'A'});
  assert.equal(first.success,true);
  assert.equal(first.isCorrect,undefined,'Do not reveal grade before CHỐT');
  await api.acceptAnswer({sessionId:101,questionIndex:0,source:'HARDWARE',participantKey:'1',playerName:'Test User',answer:'B'});
  assert.equal(rows.size,1,'Last submission must replace previous one');
  assert.equal([...rows.values()][0].answer,'B');
  assert.equal([...rows.values()][0].is_correct,null,'No premature scoring');
  const result=await api.handleClose();
  assert.equal(result.locked,1);
  const saved=[...rows.values()][0];
  assert.equal(saved.is_locked,1);
  assert.equal(saved.is_correct,1,'Latest answer B is graded, not old A');
  const publicResult=await fetch(base+'/api/round/current').then(r=>r.json());
  assert.equal(publicResult.state.correctAnswer,'B','Correct answer revealed only after CHỐT');
  assert.equal((await api.acceptAnswer({sessionId:101,questionIndex:0,source:'HARDWARE',participantKey:'1',playerName:'Test User',answer:'C'})).success,false,'Block after CHỐT');
  assert.equal(saved.answer,'B');
  assert.equal((await api.handleOpen({questionData:{id:1},questionIndex:0})).success,false,'Cannot re-open finalized question');
  assert.equal((await api.handleOpen({questionData:{id:2},questionIndex:1})).success,true,'Next round opens');
  assert.equal(published.filter(p=>p.topic.endsWith('/question')&&p.data.action==='new_question').length,2,'ESP32 must be notified of each new question');
  // Race: two MQTT answers reach backend, teacher CHỐT immediately afterwards.
  // They must be committed in receive order BEFORE grading, even though MySQL jobs are queued.
  fakeMqtt.emit('message','lagan50ki/quiz/submit',Buffer.from(JSON.stringify({device_id:1,answer:'B'})));
  fakeMqtt.emit('message','lagan50ki/quiz/submit',Buffer.from(JSON.stringify({device_id:1,answer:'A'})));
  const second=await api.handleClose();
  assert.equal(second.locked,1,'Queue must complete before grade');
  const secondRow=[...rows.values()].find(r=>r.question_index===1);
  assert.equal(secondRow.answer,'A','Last MQTT packet must be retained');
  assert.equal(secondRow.is_correct,1,'Final answer A graded correctly');
  const responsePackets=published.filter(p=>p.topic.endsWith('/response/1'));
  assert.equal(responsePackets.length,2,'Both pre-CHỐT MQTT attempts acknowledged');
  assert.equal(responsePackets.every(p=>p.data.isCorrect===undefined),true,'No correctness leak before CHỐT');
  console.log('PASS: last-answer grading, immediate-CHỐT race, lock/reopen, MQTT question and acknowledgments.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>api.server.close());
