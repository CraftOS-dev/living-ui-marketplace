export type ProficiencyLevel = 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';

export function getProficiencyScore(proficiency?: ProficiencyLevel): number {
  switch (proficiency) {
    case 'Beginner':
      return 2;
    case 'Intermediate':
      return 3;
    case 'Advanced':
      return 4;
    case 'Expert':
      return 5;
    default:
      return 4;
  }
}

export function getProficiencyFraction(proficiency?: ProficiencyLevel): string {
  const score = getProficiencyScore(proficiency);
  return `${score}/5`;
}

export function getProficiencyDots(proficiency?: ProficiencyLevel): string {
  const score = getProficiencyScore(proficiency);
  return '•'.repeat(score) + '◦'.repeat(5 - score);
}

export function getProficiencySolidDots(proficiency?: ProficiencyLevel): string {
  const score = getProficiencyScore(proficiency);
  return '●'.repeat(score) + '○'.repeat(5 - score);
}

export function getProficiencyPercentage(proficiency?: ProficiencyLevel): number {
  const score = getProficiencyScore(proficiency);
  return (score / 5) * 100;
}
