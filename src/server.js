require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || 'development-secret-change-me';
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit:'1mb' }));
app.use(express.static(path.join(__dirname,'../public')));
const trainerProgramName=r=>({voice_trainer:'Voice & Speech',instrument_trainer:'Instrumental Music',vocal_choir_trainer:'Vocal & Choir'}[r]||null);

function auth(req,res,next){
  try { req.user=jwt.verify((req.headers.authorization||'').replace('Bearer ','')||req.query.token,SECRET); next(); }
  catch { res.status(401).json({error:'Your session has expired. Please sign in again.'}); }
}
function admin(req,res,next){ return req.user.role==='admin'?next():res.status(403).json({error:'Administrator access required.'}); }
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const periodExpr={daily:"s.session_date=$1::date",weekly:"s.session_date BETWEEN date_trunc('week',$1::date)::date AND (date_trunc('week',$1::date)::date + 6)",monthly:"date_trunc('month',s.session_date)=date_trunc('month',$1::date)",annual:"date_trunc('year',s.session_date)=date_trunc('year',$1::date)"};

app.post('/api/auth/login',asyncRoute(async(req,res)=>{
  const {rows}=await db.query('SELECT * FROM users WHERE lower(email)=lower($1) AND active=true',[req.body.email]);
  const u=rows[0]; if(!u||!await bcrypt.compare(req.body.password||'',u.password_hash)) return res.status(401).json({error:'Incorrect email or password.'});
  const user={id:u.id,name:u.name,email:u.email,role:u.role,specialty:u.specialty};
  res.json({token:jwt.sign(user,SECRET,{expiresIn:'12h'}),user});
}));
app.get('/api/me',auth,(req,res)=>res.json(req.user));
app.put('/api/me',auth,admin,asyncRoute(async(req,res)=>{
  const b=req.body;
  const {rows}=await db.query('UPDATE users SET name=$1,email=$2,specialty=$3 WHERE id=$4 RETURNING id,name,email,role,specialty',[b.name,b.email,b.specialty||null,req.user.id]);
  if(!rows[0])return res.status(404).json({error:'User not found.'});
  res.json(rows[0]);
}));

app.get('/api/dashboard',auth,asyncRoute(async(req,res)=>{
  const scope=req.user.role==='admin'?'':`AND s.trainer_id='${req.user.id}'`;
  const programScope=req.user.role==='admin'?'':`WHERE p.name='${trainerProgramName(req.user.role)}'`;
  const [stats,trend,recent,programs]=await Promise.all([
    db.query(`SELECT count(DISTINCT s.id)::int sessions,count(a.*) FILTER(WHERE a.status IN('present','late'))::int attended,count(a.*)::int expected,
      count(DISTINCT s.trainer_id)::int trainers FROM training_sessions s LEFT JOIN attendance a ON a.session_id=s.id WHERE s.status='completed' AND s.session_date>=date_trunc('month',CURRENT_DATE) ${scope}`),
    db.query(`SELECT to_char(d,'Dy') label,coalesce(round(100.0*count(a.*) FILTER(WHERE a.status IN('present','late'))/nullif(count(a.*),0)),0)::int value FROM generate_series(CURRENT_DATE-6,CURRENT_DATE,'1 day') d LEFT JOIN training_sessions s ON s.session_date=d ${scope} LEFT JOIN attendance a ON a.session_id=s.id GROUP BY d ORDER BY d`),
    db.query(`SELECT r.* FROM report_session_summary r JOIN training_sessions s ON s.id=r.id WHERE true ${scope} ORDER BY r.session_date DESC LIMIT 5`),
    db.query(`SELECT p.name,p.color,count(DISTINCT s.id)::int sessions,coalesce(round(avg(r.attendance_rate)),0)::int rate FROM programs p LEFT JOIN training_sessions s ON s.program_id=p.id AND s.session_date>=date_trunc('month',CURRENT_DATE) LEFT JOIN report_session_summary r ON r.id=s.id ${programScope} GROUP BY p.id ORDER BY p.name`)
  ]);
  res.json({stats:stats.rows[0],trend:trend.rows,recent:recent.rows,programs:programs.rows});
}));

app.get('/api/learners',auth,asyncRoute(async(req,res)=>{
 const q=`%${req.query.search||''}%`,params=[q];let scope='';
 if(req.user.role!=='admin'){params.push(trainerProgramName(req.user.role));scope=` AND p.name=$${params.length}`;}
 const {rows}=await db.query(`SELECT l.*,coalesce(string_agg(p.name,', '),'Not enrolled') programs FROM learners l LEFT JOIN enrollments e ON e.learner_id=l.id AND e.active LEFT JOIN programs p ON p.id=e.program_id WHERE l.active AND (l.name ILIKE $1 OR l.admission_no ILIKE $1) ${scope} GROUP BY l.id ORDER BY l.name`,params); res.json(rows);
}));
app.post('/api/learners',auth,admin,asyncRoute(async(req,res)=>{const b=req.body;const {rows}=await db.query('INSERT INTO learners(admission_no,name,email,phone,photo_url,guardian_name,guardian_phone) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[b.admission_no,b.name,b.email||null,b.phone||null,b.photo_url||null,b.guardian_name||null,b.guardian_phone||null]);res.status(201).json(rows[0]);}));
app.put('/api/learners/:id',auth,admin,asyncRoute(async(req,res)=>{const b=req.body;const {rows}=await db.query(`UPDATE learners SET name=$1,admission_no=$2,email=$3,phone=$4,photo_url=$5,guardian_name=$6,guardian_phone=$7 WHERE id=$8 RETURNING *`,[b.name,b.admission_no,b.email||null,b.phone||null,b.photo_url||null,b.guardian_name||null,b.guardian_phone||null,req.params.id]);if(!rows[0])return res.status(404).json({error:'Learner not found.'});res.json(rows[0]);}));
app.delete('/api/learners/:id',auth,admin,asyncRoute(async(req,res)=>{const {rowCount}=await db.query('UPDATE learners SET active=false WHERE id=$1',[req.params.id]);if(!rowCount)return res.status(404).json({error:'Learner not found.'});res.status(204).end();}));
app.get('/api/trainers',auth,asyncRoute(async(req,res)=>{const {rows}=await db.query("SELECT id,name,email,role,specialty,phone,active,created_at FROM users WHERE role<>'admin' AND active ORDER BY name");res.json(rows);}));
app.post('/api/trainers',auth,admin,asyncRoute(async(req,res)=>{const b=req.body,hash=await bcrypt.hash(b.password||'Welcome123!',10);const {rows}=await db.query('INSERT INTO users(name,email,password_hash,role,specialty,phone) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,email,role,specialty,phone,active',[b.name,b.email,hash,b.role,b.specialty,b.phone||null]);res.status(201).json(rows[0]);}));
app.put('/api/trainers/:id',auth,admin,asyncRoute(async(req,res)=>{const b=req.body;let rows;if(b.password){const hash=await bcrypt.hash(b.password,10);({rows}=await db.query(`UPDATE users SET name=$1,email=$2,role=$3,specialty=$4,phone=$5,password_hash=$6 WHERE id=$7 AND role<>'admin' RETURNING id,name,email,role,specialty,phone,active`,[b.name,b.email,b.role,b.specialty||null,b.phone||null,hash,req.params.id]));}else{({rows}=await db.query(`UPDATE users SET name=$1,email=$2,role=$3,specialty=$4,phone=$5 WHERE id=$6 AND role<>'admin' RETURNING id,name,email,role,specialty,phone,active`,[b.name,b.email,b.role,b.specialty||null,b.phone||null,req.params.id]));}if(!rows[0])return res.status(404).json({error:'Trainer not found.'});res.json(rows[0]);}));
app.delete('/api/trainers/:id',auth,admin,asyncRoute(async(req,res)=>{const {rowCount}=await db.query("UPDATE users SET active=false WHERE id=$1 AND role<>'admin'",[req.params.id]);if(!rowCount)return res.status(404).json({error:'Trainer not found.'});res.status(204).end();}));
app.get('/api/programs',auth,asyncRoute(async(req,res)=>{const params=[],scope=req.user.role==='admin'?'':' AND name=$1';if(scope)params.push(trainerProgramName(req.user.role));const {rows}=await db.query(`SELECT * FROM programs WHERE active${scope} ORDER BY name`,params);res.json(rows);}));
app.get('/api/programs/:id/learners',auth,asyncRoute(async(req,res)=>{const params=[req.params.id],scope=req.user.role==='admin'?'':' AND p.name=$2';if(scope)params.push(trainerProgramName(req.user.role));const {rows}=await db.query(`SELECT l.id,l.name,l.admission_no,l.photo_url FROM learners l JOIN enrollments e ON e.learner_id=l.id JOIN programs p ON p.id=e.program_id WHERE e.program_id=$1 AND e.active AND l.active${scope} ORDER BY l.name`,params);res.json(rows);}));
app.get('/api/programs/:id',auth,asyncRoute(async(req,res)=>{const params=[req.params.id],scope=req.user.role==='admin'?'':' AND name=$2';if(scope)params.push(trainerProgramName(req.user.role));const [program,learners,sessions]=await Promise.all([db.query(`SELECT * FROM programs WHERE id=$1 AND active${scope}`,params),db.query('SELECT l.id,l.name,l.admission_no,l.email,l.photo_url FROM learners l JOIN enrollments e ON e.learner_id=l.id WHERE e.program_id=$1 AND e.active AND l.active ORDER BY l.name',[req.params.id]),db.query('SELECT r.* FROM report_session_summary r WHERE r.program_id=$1 ORDER BY r.session_date DESC LIMIT 5',[req.params.id])]);if(!program.rows[0])return res.status(404).json({error:'Program not found.'});res.json({...program.rows[0],learners:learners.rows,recent:sessions.rows});}));

app.get('/api/sessions',auth,asyncRoute(async(req,res)=>{
 const params=[],where=['1=1']; if(req.user.role!=='admin'){params.push(req.user.id);where.push(`s.trainer_id=$${params.length}`)} if(req.query.from){params.push(req.query.from);where.push(`s.session_date>=$${params.length}`)} if(req.query.to){params.push(req.query.to);where.push(`s.session_date<=$${params.length}`)} if(req.query.trainer){params.push(req.query.trainer);where.push(`s.trainer_id=$${params.length}`)};
 const {rows}=await db.query(`SELECT r.*,s.started_at,s.ended_at,s.venue,s.exercises,s.trainer_comments FROM report_session_summary r JOIN training_sessions s ON s.id=r.id WHERE ${where.join(' AND ')} ORDER BY s.session_date DESC`,params);res.json(rows);
}));
app.get('/api/sessions/:id',auth,asyncRoute(async(req,res)=>{const params=[req.params.id],scope=req.user.role==='admin'?'':` AND s.trainer_id=$2`;if(scope)params.push(req.user.id);const [session,attendance]=await Promise.all([db.query(`SELECT r.*,s.started_at,s.ended_at,s.venue,s.exercises,s.trainer_comments FROM report_session_summary r JOIN training_sessions s ON s.id=r.id WHERE s.id=$1${scope}`,params),db.query(`SELECT a.status,a.note,l.name,l.admission_no,l.photo_url FROM attendance a JOIN learners l ON l.id=a.learner_id JOIN training_sessions s ON s.id=a.session_id WHERE a.session_id=$1${scope}`,params)]);if(!session.rows[0])return res.status(404).json({error:'Report not found.'});res.json({...session.rows[0],attendance:attendance.rows});}));
app.post('/api/sessions',auth,asyncRoute(async(req,res)=>{
 const b=req.body,trainer=req.user.role==='admin'&&b.trainer_id?b.trainer_id:req.user.id;
 const client=await db.pool.connect(); try{await client.query('BEGIN'); const {rows}=await client.query(`INSERT INTO training_sessions(trainer_id,program_id,session_date,started_at,ended_at,venue,lesson_topic,activities,exercises,trainer_comments,observation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[trainer,b.program_id,b.session_date,b.started_at,b.ended_at,b.venue,b.lesson_topic,b.activities,b.exercises,b.trainer_comments,b.observation]);
 for(const a of b.attendance||[]) await client.query('INSERT INTO attendance(session_id,learner_id,status,note) VALUES($1,$2,$3,$4)',[rows[0].id,a.learner_id,a.status,a.note||null]); await client.query('INSERT INTO audit_log(user_id,action,entity_type,entity_id) VALUES($1,$2,$3,$4)',[req.user.id,'CREATE_REPORT','session',rows[0].id]);await client.query('COMMIT');res.status(201).json(rows[0]);}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}));

async function reportData(type,date,trainer){const condition=periodExpr[type]||periodExpr.monthly;const vals=[date];let extra='';if(trainer){vals.push(trainer);extra=` AND s.trainer_id=$${vals.length}`};const {rows}=await db.query(`SELECT r.* FROM report_session_summary r JOIN training_sessions s ON s.id=r.id WHERE ${condition} ${extra} ORDER BY s.session_date`,vals);return rows}
app.get('/api/reports/:type',auth,asyncRoute(async(req,res)=>{const trainer=req.user.role==='admin'?req.query.trainer:req.user.id;const rows=await reportData(req.params.type,req.query.date||new Date().toISOString().slice(0,10),trainer);const attended=rows.reduce((n,r)=>n+Number(r.attended),0),expected=rows.reduce((n,r)=>n+Number(r.expected),0);res.json({type:req.params.type,rows,summary:{sessions:rows.length,attended,expected,rate:expected?Math.round(attended/expected*100):0}});}));
app.get('/api/reports/:type/export.:format',auth,asyncRoute(async(req,res)=>{const trainer=req.user.role==='admin'?req.query.trainer:req.user.id,rows=await reportData(req.params.type,req.query.date||new Date().toISOString().slice(0,10),trainer);if(req.params.format==='xlsx'){const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Report');ws.columns=[['Date','session_date'],['Program','program_name'],['Trainer','trainer_name'],['Topic','lesson_topic'],['Expected','expected'],['Attended','attended'],['Attendance %','attendance_rate']].map(([header,key])=>({header,key,width:20}));ws.addRows(rows);ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF534AB7'}};res.setHeader('Content-Disposition',`attachment; filename=${req.params.type}-report.xlsx`);await wb.xlsx.write(res);return res.end()}
 const doc=new PDFDocument({margin:48});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename=${req.params.type}-report.pdf`);doc.pipe(res);doc.fontSize(22).fillColor('#302B48').text(`${req.params.type[0].toUpperCase()+req.params.type.slice(1)} Training Report`);doc.moveDown().fontSize(10).fillColor('#777').text(`Generated ${new Date().toLocaleString()}`);doc.moveDown();rows.forEach(r=>{doc.fontSize(12).fillColor('#302B48').text(`${r.session_date.toISOString?.().slice(0,10)||r.session_date}  •  ${r.program_name}`,{continued:false});doc.fontSize(9).fillColor('#555').text(`${r.trainer_name} — ${r.lesson_topic} | Attendance: ${r.attended}/${r.expected} (${r.attendance_rate||0}%)`);doc.moveDown(.7)});doc.end();}));

app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));
app.use((err,req,res,next)=>{console.error(err);res.status(err.code==='23505'?409:500).json({error:err.code==='23505'?'That record already exists.':'Something went wrong. Please try again.'})});
app.listen(PORT,()=>console.log(`TMR System running at http://localhost:${PORT}`));
