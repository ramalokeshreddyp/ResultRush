// Quick debug: run the scraper and dump what it finds
const { scrapeResult } = require('./server/services/scraper');

scrapeResult('23A91A05I2').then(function(r) {
  console.log('CGPA:', r.cgpa);
  console.log('credits:', r.totalCredits);
  console.log('backlogs:', r.backlogs);
  console.log('latestSemLabel:', r.latestSemLabel);
  console.log('courses.length:', r.courses.length);
  if (r.courses.length > 0) {
    console.log('courses[0]:', JSON.stringify(r.courses[0]));
    console.log('courses[1]:', JSON.stringify(r.courses[1]));
  } else {
    console.log('NO COURSES FOUND - need to debug table parser');
  }
}).catch(function(e) {
  console.error('Error:', e.message);
});
