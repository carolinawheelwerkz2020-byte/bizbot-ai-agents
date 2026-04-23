export const CWW_BUSINESS_CONTEXT = {
  businessName: 'Carolina Wheel Werkz',
  ownerName: 'Bobby Sanderlin',
  websiteUrl: 'https://carolinawheelwerkz.com',
  dashboardUrl: import.meta.env.VITE_CWW_DASHBOARD_URL || 'https://update-cww-app.web.app/',
  firebaseProjectId: import.meta.env.VITE_CWW_FIREBASE_PROJECT_ID || 'carolinawheelwerkz',
  firebaseProjectNumber: import.meta.env.VITE_CWW_FIREBASE_PROJECT_NUMBER || '797904737702',
  gcpParentOrg: import.meta.env.VITE_CWW_GCP_PARENT_ORG || 'carolinawheelwerkz2020-org',
  primaryServices: [
    'wheel repair',
    'wheel straightening',
    'powder coating',
    'automotive reconditioning',
    'B2B dealership support',
  ],
  knownCompetitors: [
    'Dent Wizard',
    'Auto Recon Pro',
    'Carolina Wheel Repair',
  ],
};

export function dashboardContextLine() {
  return [
    `${CWW_BUSINESS_CONTEXT.businessName} dashboard: ${CWW_BUSINESS_CONTEXT.dashboardUrl}`,
    `Firebase project: ${CWW_BUSINESS_CONTEXT.firebaseProjectId} (${CWW_BUSINESS_CONTEXT.firebaseProjectNumber})`,
    `Website: ${CWW_BUSINESS_CONTEXT.websiteUrl}`,
  ].join('\n');
}
