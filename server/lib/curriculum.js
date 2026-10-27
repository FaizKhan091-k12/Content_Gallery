'use strict';
// The book structure (Subject > Grade > [Strand] > Unit > Lesson), seeded from the team's Google Sheets
// exports in server/seed and stored in data/curriculum.json, where the admin can extend it.

const fs = require('fs');
const path = require('path');

const SUBJECTS = [
  { name: 'Mathematics', short: 'Maths', color: '#2f80ed' },
  { name: 'Science', short: 'Science', color: '#27ae60' },
  { name: 'Hindi', short: 'Hindi', color: '#f2994a' },
  { name: 'English', short: 'English', color: '#9b51e0' },
  { name: 'Global Perspectives', short: 'Global P.', color: '#00a3a3' },
];

const STRANDS = ['Biology', 'Chemistry', 'Physics'];

function readSeed(dir, file) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  return text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('|').map((c) => c.trim()));
}

const stripUnitPrefix = (t) => t.replace(/^Unit\s*\d+\s*:\s*/i, '').trim();

function lessonId(l) {
  const subject = l.subject.toLowerCase().replace(/[^a-z]+/g, '');
  const strand = l.strand ? l.strand.toLowerCase() + '-' : '';
  return `${subject}-g${l.grade}-${strand}u${l.unit}-l${l.lesson}`;
}

function buildFromSeed(seedDir) {
  const lessons = [];

  for (const [g, u, unitTitle, l, lessonTitle, chapter] of readSeed(seedDir, 'math.txt')) {
    lessons.push({ subject: 'Mathematics', strand: '', grade: +g, unit: +u, unitTitle: stripUnitPrefix(unitTitle), lesson: +l, lessonTitle, chapter });
  }

  // Grades 6-8 Science are split into strands; a "Biology_" style prefix starts a strand and carries on
  // until the next prefix (e.g. G6 Physics units 2 and 3 have no prefix).
  let strand = '';
  let strandGrade = 0;
  for (const [g, u, unitTitle, l, lessonTitle, chapter] of readSeed(seedDir, 'science.txt')) {
    const grade = +g;
    if (grade !== strandGrade) { strand = ''; strandGrade = grade; }
    let title = stripUnitPrefix(unitTitle);
    const m = title.match(/^(Biology|Chemistry|Physics)_(.*)$/);
    if (m) { strand = m[1]; title = m[2].trim(); }
    lessons.push({ subject: 'Science', strand: grade >= 6 ? strand : '', grade, unit: +u, unitTitle: title, lesson: +l, lessonTitle, chapter });
  }

  // Hindi numbers lessons through the whole book; grammar (Vyakaran) is its own section.
  const hindiUnitTitles = {};
  for (const [g, u, unitTitle] of readSeed(seedDir, 'hindi.txt')) {
    if (unitTitle && u !== 'V') hindiUnitTitles[`${g}-${u}`] = unitTitle;
  }
  for (const [g, u, , l, lessonTitle, chapter] of readSeed(seedDir, 'hindi.txt')) {
    const grammar = u === 'V';
    lessons.push({
      subject: 'Hindi', strand: '', grade: +g,
      unit: grammar ? 99 : +u,
      unitTitle: grammar ? 'व्याकरण (Vyakaran)' : hindiUnitTitles[`${g}-${u}`] || `इकाई ${u}`,
      lesson: +l, lessonTitle, chapter,
    });
  }

  for (const l of lessons) l.id = lessonId(l);
  // de-duplicate ids (a sheet can repeat a lesson number) by suffixing
  const seen = new Map();
  for (const l of lessons) {
    const n = (seen.get(l.id) || 0) + 1;
    seen.set(l.id, n);
    if (n > 1) l.id += '-' + n;
  }

  return { version: 1, source: 'Google Sheets: K12 Content Upload Status (Math, Sci, Hindi)', subjects: SUBJECTS, strands: STRANDS, lessons, suggestions: buildSuggestions(seedDir) };
}

/** Planned game titles from the "UCD_Digital Assets > Games" sheet, keyed by grade/subject/unit/lesson. */
function buildSuggestions(seedDir) {
  const out = [];
  for (const [g, subj, topic] of readSeed(seedDir, 'games.txt')) {
    const subject = STRANDS.includes(subj) ? 'Science' : subj;
    const strand = STRANDS.includes(subj) ? subj : '';
    const m = topic.match(/^Unit\s*(\d+)\s*_\s*Lesson\s*_?\s*(\d+)\s*_\s*(.*)$/i);
    const l = topic.match(/^Lesson\s*(\d+)\s*_\s*(.*)$/i);
    if (m) out.push({ grade: +g, subject, strand, unit: +m[1], lesson: +m[2], title: m[3].trim() });
    else if (l) out.push({ grade: +g, subject, strand, unit: 0, lesson: +l[1], title: l[2].trim() });
    else out.push({ grade: +g, subject, strand, unit: 0, lesson: 0, title: topic.trim() });
  }
  return out.filter((s) => s.title);
}

function loadCurriculum(store, seedDir) {
  let c = store.get('curriculum', null);
  if (!c) {
    c = buildFromSeed(seedDir);
    store.set('curriculum', c);
  }
  return c;
}

module.exports = { loadCurriculum, buildFromSeed, lessonId, SUBJECTS };
