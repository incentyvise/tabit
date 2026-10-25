import { appConfig } from "@/app/config";
import { HomePageContent } from "@/components/home-page-content";
import { faqs } from "@/lib/home-content";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${appConfig.appUrl}/#website`,
      name: appConfig.name,
      url: appConfig.appUrl,
      description: appConfig.description,
      publisher: { "@id": `${appConfig.appUrl}/#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${appConfig.appUrl}/#organization`,
      name: appConfig.name,
      url: appConfig.appUrl,
      logo: `${appConfig.appUrl}/icon-192x192.png`,
      description: appConfig.description,
      founder: {
        "@type": "Person",
        name: appConfig.creator.name,
        url: appConfig.creator.website,
      },
      sameAs: [appConfig.githubUrl, appConfig.creator.twitter],
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${appConfig.appUrl}/#app`,
      name: appConfig.name,
      alternateName: "Tabit",
      description: appConfig.description,
      url: appConfig.appUrl,
      installUrl: appConfig.pwaUrl,
      image: `${appConfig.appUrl}/opengraph.png`,
      applicationCategory: "FinanceApplication",
      applicationSubCategory: "Expense splitting",
      operatingSystem: "Web, iOS, Android, macOS, Windows, Linux",
      isAccessibleForFree: true,
      featureList: [
        "Unlimited expenses with no daily limit",
        "No ads",
        "Group and one-on-one tabs",
        "Equal, exact amount, percentage, and share splits",
        "Multi-currency expenses with automatic conversion",
        "Recurring expenses",
        "Voice expense entry",
        "Payment reminders",
        "Placeholder friends",
        "QR code and link invites",
        "Simplified debts",
        "Expense search",
        "Expense edit history",
        "Passwordless email sign-in",
        "Splitwise CSV import",
        "Real-time sync and push notifications",
        "Open source and self-hostable",
      ],
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      publisher: { "@id": `${appConfig.appUrl}/#organization` },
    },
    {
      "@type": "SoftwareSourceCode",
      name: `${appConfig.name} source code`,
      codeRepository: appConfig.githubUrl,
      programmingLanguage: "TypeScript",
      targetProduct: { "@id": `${appConfig.appUrl}/#app` },
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    },
  ],
};

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <HomePageContent />
    </>
  );
}
