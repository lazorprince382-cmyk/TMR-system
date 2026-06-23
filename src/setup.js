require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

async function setup() {
  await pool.query(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  const password = await bcrypt.hash('Welcome123!', 10);
  await pool.query(`INSERT INTO users(name,email,password_hash,role,specialty) VALUES
    ('Grace Nansubuga','admin@tmr.local',$1,'admin','Human Resources'),
    ('Daniel Okello','voice@tmr.local',$1,'voice_trainer','Voice & Speech'),
    ('Sarah Akello','instrument@tmr.local',$1,'instrument_trainer','Piano & Guitar'),
    ('Michael Kato','choir@tmr.local',$1,'vocal_choir_trainer','Choir & Harmony')
    ON CONFLICT(email) DO NOTHING`, [password]);
  await pool.query(`INSERT INTO programs(name,description,color) VALUES
    ('Voice & Speech','Voice control, diction and performance','#6C5CE7'),
    ('Instrumental Music','Piano, guitar and music theory','#00A896'),
    ('Vocal & Choir','Harmony, ensemble and vocal technique','#F4A261')
    ON CONFLICT(name) DO NOTHING`);
  const names = ['Amina Namusoke','Brian Mugisha','Claire Atim','David Ouma','Esther Nakato','Frank Tumusiime','Gloria Achen','Henry Ssemanda','Irene Apio','Joel Wasswa','Karen Nabwire','Luke Kizito'];
  for (let i=0;i<names.length;i++) await pool.query('INSERT INTO learners(admission_no,name,email,photo_url) VALUES($1,$2,$3,$4) ON CONFLICT(admission_no) DO UPDATE SET photo_url=coalesce(learners.photo_url,EXCLUDED.photo_url)',[`TMR-${String(i+1).padStart(3,'0')}`,names[i],`${names[i].toLowerCase().replace(' ','.')}@example.com`,`https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(names[i])}`]);
  await pool.query(`INSERT INTO enrollments(learner_id,program_id)
    SELECT l.id,p.id FROM learners l CROSS JOIN programs p
    WHERE (substring(l.admission_no from 5)::int + CASE p.name WHEN 'Voice & Speech' THEN 0 WHEN 'Instrumental Music' THEN 1 ELSE 2 END) % 3 <> 0
    ON CONFLICT DO NOTHING`);
  console.log('Database ready. Login: admin@tmr.local / Welcome123!');
}
setup().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
