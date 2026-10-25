export const appConfig = {
  name: "Tab",
  fullName: "Tab - Split expenses with friends",
  description:
    "Tab is a free, open source expense splitting app and Splitwise alternative. Split bills with roommates, trips, couples, and friends with no expense limits, no ads, and no paid tier.",
  seo: {
    title: "Tab: Free, Open Source Splitwise Alternative",
    description:
      "Tab is the free, open source Splitwise alternative. Split bills with roommates, trips, and friends: unlimited expenses, no ads, multi-currency, recurring bills, and Splitwise import. Self-host or use it free.",
  },
  appUrl: process.env.NEXT_PUBLIC_WEB_URL ?? "https://tabit.in",
  githubUrl: "https://github.com/incentyvise/tabit",
  donateUrl: process.env.NEXT_PUBLIC_DONATE_URL ?? "",
  support: {
    paypalUrl: "https://paypal.me/parthkoshti",
    venmoUrl: "https://venmo.com/pVader",
  },
  pwaUrl: "https://app.tabit.in",
  creator: {
    name: "Parth Koshti",
    github: "https://github.com/parthkoshti",
    website: "https://parthkoshti.com",
    twitter: "https://x.com/itsparthvader",
    otherProjects: [
      { name: "SnitchFeed", url: "https://snitchfeed.com" },
      { name: "Conncord", url: "https://conncord.com" },
    ],
  },
} as const;
