/**
 * Company logo actions and labels shared by the heroes and the edit sheet
 * (fix 5). Small on purpose: pages import it eagerly, the sheet itself
 * (EditCompany.tsx) loads on first use.
 */
import { op, opForm } from '../../lib/api.ts';
import { logoProblem, primeImage } from '../../lib/images.ts';
import { act, patch } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';

/** What a company change makes screens reload (the company, its people, and the lists that show its logo). */
export const COMPANY_EDIT_READS = ['companies', 'people', 'employments', 'deal_people', 'holdings', 'deals', 'intake_items'];

/** A company's own stage (companies.stage) as people read it. */
export const STAGE_LABEL: Record<string, string> = { idea: 'Idea', pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b: 'Series B', series_c: 'Series C', growth: 'Growth' };

/** Set a company's logo from a picked file: every screen shows it at once; answers true when it is stored. */
export async function setCompanyLogo(company: string, file: File): Promise<boolean> {
  const problem = logoProblem(file);
  if (problem !== null) {
    toast.error(problem);
    return false;
  }
  const local = URL.createObjectURL(file);
  const out = await act([patch(company, { logo_url: local })], () => opForm<{ company: { logo_url: string } }>('companies.logo-set', { company }, { file }), COMPANY_EDIT_READS);
  if (out !== null) primeImage(out.company.logo_url, local);
  return out !== null;
}

/** Remove a company's own logo (screens show its website icon, else its letter). */
export async function removeCompanyLogo(company: string): Promise<boolean> {
  const out = await act([patch(company, { logo_url: '' })], () => op('companies.logo-remove', { company }), COMPANY_EDIT_READS);
  return out !== null;
}
