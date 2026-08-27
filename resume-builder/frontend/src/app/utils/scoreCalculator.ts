import type { ResumeData, ResumeScore } from '../types/resume';

const ACTION_VERBS = [
  'spearheaded', 'engineered', 'architected', 'led', 'scaled', 'built', 'redesigned',
  'accelerated', 'optimized', 'pioneered', 'transformed', 'delivered', 'launched',
  'implemented', 'championed', 'orchestrated', 'streamlined', 'cut', 'grew', 'doubled'
];

export function calculateResumeScore(resume: ResumeData): ResumeScore {
  const { personal, experiences, educations, skills, myTime, mostProudOf, philosophy, projects } = resume;

  // 1. Personal & Contact Details (max 20)
  let contactScore = 0;
  if (personal.fullName) contactScore += 4;
  if (personal.jobTitle) contactScore += 4;
  if (personal.email) contactScore += 4;
  if (personal.phone) contactScore += 3;
  if (personal.location) contactScore += 3;
  if (personal.linkedin || personal.github || personal.website) contactScore += 2;
  const contactCompleteness = Math.min(20, contactScore);

  // 2. Summary & Value Proposition (max 20)
  let summaryScore = 0;
  const summaryText = personal.summary || '';
  const wordCount = summaryText.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount >= 15) summaryScore += 10;
  if (wordCount >= 30) summaryScore += 6;
  if (wordCount >= 45) summaryScore += 4;
  const summaryQuality = Math.min(20, summaryScore);

  // 3. Experience & Action Verbs (max 20)
  let verbScore = 0;
  if (experiences.length >= 1) verbScore += 5;
  let actionVerbCount = 0;
  const expText = experiences.map(e => e.description.toLowerCase()).join(' ');
  ACTION_VERBS.forEach(verb => {
    if (expText.includes(verb)) actionVerbCount++;
  });
  verbScore += Math.min(15, actionVerbCount * 5);
  const actionVerbs = Math.min(20, verbScore);

  // 4. Quantifiable Metrics & Impact (max 20)
  const metricRegex = /(\d+%\b|\$\d+|\d+M\b|\d+k\b|\b\d+\+\b|\b\d{2,}\b)/g;
  const metricMatches = (expText.match(metricRegex) || []).length;
  const quantifiableMetrics = Math.min(20, metricMatches * 5);

  // 5. Skills & Visual Highlights (max 20)
  let visualScore = 0;
  if (skills.length >= 3) visualScore += 7;
  if ((myTime && myTime.length >= 2) || (mostProudOf && mostProudOf.length >= 2)) visualScore += 7;
  if ((projects && projects.length >= 1) || (philosophy && philosophy.quote)) visualScore += 6;
  const visualHighlights = Math.min(20, visualScore);

  const totalScore = contactCompleteness + summaryQuality + actionVerbs + quantifiableMetrics + visualHighlights;

  // Generate suggestions
  const suggestions: ResumeScore['suggestions'] = [];

  if (quantifiableMetrics < 15) {
    suggestions.push({
      id: 'metric-tip',
      type: 'warning',
      message: 'Add quantifiable metrics (percentages %, dollar amounts $, or numbers) to prove impact in Work Experience.'
    });
  }

  if (actionVerbs < 15) {
    suggestions.push({
      id: 'verb-tip',
      type: 'warning',
      message: 'Use strong action verbs (e.g. Spearheaded, Engineered, Architected, Scaled) to start experience bullets.'
    });
  }

  if (myTime.length < 2 || mostProudOf.length < 2) {
    suggestions.push({
      id: 'visual-tip',
      type: 'tip',
      message: 'Fill out "My Time" pie graph and "Most Proud Of" badges to make your resume stand out with visual highlights.'
    });
  }

  if (wordCount < 30) {
    suggestions.push({
      id: 'summary-tip',
      type: 'tip',
      message: 'Expand your Summary section to 30+ words highlighting key value prop & total years experience.'
    });
  }

  if (totalScore >= 85) {
    suggestions.push({
      id: 'all-good',
      type: 'success',
      message: 'Awesome job! Your resume scores high across all 5 core criteria!'
    });
  }

  return {
    score: totalScore,
    breakdown: {
      contactCompleteness,
      summaryQuality,
      actionVerbs,
      quantifiableMetrics,
      visualHighlights
    },
    suggestions
  };
}
