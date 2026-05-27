export type GlossaryEntry = {
  label: string;
  business_meaning: string;
  formula?: string;
  example?: string;
};

export const BUSINESS_GLOSSARY: Record<string, GlossaryEntry> = {
  FCST_ACCY: {
    label: 'FCST ACCY',
    business_meaning: 'Forecast accuracy: how close forecasted units were to actual units sold.',
    formula: '1 - ABS(Forecast - Actual) / Actual',
    example: '85% means forecast tracked actual demand closely.',
  },
  ROAS: {
    label: 'ROAS',
    business_meaning: 'Return on ad spend: revenue generated per $1 of ad spend.',
    formula: 'Attributed Revenue / Ad Spend',
    example: '4.1x means $4.10 revenue per $1 spend.',
  },
  DOS: {
    label: 'DoS',
    business_meaning: 'Days of Supply: number of days inventory can cover at current sell-through.',
    formula: 'On-hand Units / Avg Daily Units Sold',
  },
  CO_OP: {
    label: 'Co-op',
    business_meaning: 'Vendor co-op marketing funds available for approved campaigns.',
  },
  INV_HEALTH: {
    label: 'INV. HEALTH',
    business_meaning: 'Inventory health score using stock balance, supply days, and risk thresholds.',
  },
  PROMO_LIFT: {
    label: 'PROMO LIFT',
    business_meaning: 'Incremental sales uplift caused by promotions vs non-promo baseline.',
  },
};
