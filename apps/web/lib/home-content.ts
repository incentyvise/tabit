// Shared homepage copy. Kept out of the client component so the server page
// can reuse the FAQ for FAQPage structured data.

export const faqs = [
  {
    question: "What is Tab?",
    answer:
      "Tab is a free, open source app for splitting expenses with friends, roommates, partners, and travel groups. You add shared expenses, Tab keeps a running balance of who owes whom, and you settle up when you're ready. It runs in the browser and installs on iPhone, Android, and desktop as a progressive web app.",
  },
  {
    question: "Is Tab a good Splitwise alternative?",
    answer:
      "Yes. Tab covers what most people use Splitwise for: group and one-on-one tabs, equal or uneven splits, multiple currencies, recurring bills, and settling up. The difference is that everything is free with no daily expense limit, no ads, and no paid tier, and the code is open source so you can self-host it.",
  },
  {
    question: "Is Tab really free? What's the catch?",
    answer:
      "There is no catch and no premium plan. The hosted version at tabit.in is free forever and funded by optional donations. Running it costs very little, and keeping it free is the whole point of the project.",
  },
  {
    question: "Is there a limit on how many expenses I can add?",
    answer:
      "No. Add as many expenses, tabs, and friends as you want. There is no daily cap, no cooldown timer, and no feature locked behind an upgrade.",
  },
  {
    question: "Can I import my data from Splitwise?",
    answer:
      "Yes. Export your expenses from Splitwise as a CSV file and import it into Tab. Your history comes with you, so you can keep going without starting from zero.",
  },
  {
    question: "Is Tab open source? Can I self-host it?",
    answer:
      "Yes. The full source code is on GitHub. You can read it, audit it, contribute to it, or run your own instance on your own server so your expense data never leaves your infrastructure.",
  },
  {
    question: "Does Tab support multiple currencies?",
    answer:
      "Yes. Each tab has a home currency, and every expense or settlement can be recorded in the currency you actually paid in. Tab converts it using the exchange rate for that transaction's date, which makes it useful for trips abroad.",
  },
  {
    question: "Does Tab work on iPhone and Android?",
    answer:
      "Yes. Tab is a progressive web app, so you can install it to your home screen on iPhone, Android, Mac, Windows, or Linux straight from the browser. It supports push notifications and stays in sync across devices.",
  },
  {
    question: "Do my friends need an account before I can split with them?",
    answer:
      "No. Add them as a placeholder friend on a group tab and start splitting right away. When they sign up, merge the placeholder into their account in one step and their history moves over.",
  },
] as const;

export type ComparisonValue = boolean | string;

export const comparisonRows: {
  feature: string;
  tab: ComparisonValue;
  splitwiseFree: ComparisonValue;
  splitwisePro: ComparisonValue;
}[] = [
  {
    feature: "Unlimited expenses",
    tab: true,
    splitwiseFree: "Daily limit",
    splitwisePro: true,
  },
  { feature: "No ads", tab: true, splitwiseFree: false, splitwisePro: true },
  {
    feature: "Automatic currency conversion",
    tab: true,
    splitwiseFree: false,
    splitwisePro: true,
  },
  {
    feature: "Search expenses",
    tab: true,
    splitwiseFree: false,
    splitwisePro: true,
  },
  {
    feature: "Simplified debts",
    tab: true,
    splitwiseFree: true,
    splitwisePro: true,
  },
  {
    feature: "Recurring expenses",
    tab: true,
    splitwiseFree: true,
    splitwisePro: true,
  },
  {
    feature: "Open source",
    tab: true,
    splitwiseFree: false,
    splitwisePro: false,
  },
  {
    feature: "Self-hostable",
    tab: true,
    splitwiseFree: false,
    splitwisePro: false,
  },
  {
    feature: "Price",
    tab: "Free forever",
    splitwiseFree: "Free",
    splitwisePro: "About $40/year",
  },
];
