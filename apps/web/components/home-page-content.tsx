"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion, useInView, useMotionValue, useSpring } from "framer-motion";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { appConfig } from "@/app/config";
import { comparisonRows, faqs, type ComparisonValue } from "@/lib/home-content";
import {
  ReceiptText,
  Users,
  Github,
  ArrowRight,
  Monitor,
  Mic,
  QrCode,
  Zap,
  MessageCircle,
  Download,
  BanknoteArrowUp,
  Wallet,
  ChevronLeft,
  ChevronDown,
  Settings,
  PieChart,
  BellRing,
  CalendarClock,
  Link2,
  UserRound,
  Check,
  X,
  Home,
  Plane,
  Heart,
  PartyPopper,
  ShieldCheck,
  Code2,
  Server,
  GitFork,
  FileDown,
  Upload,
  UserPlus,
  Shuffle,
  Search,
  History,
  KeyRound,
} from "lucide-react";

const staggerChild = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94],
    },
  },
};

const features = [
  {
    icon: Mic,
    title: "Log expenses by voice",
    description:
      'Say "Alex paid 30 for pizza in Roomies" and it\'s logged. Tab works out who paid, how much, and which tab it belongs to.',
  },
  {
    icon: PieChart,
    title: "Split it your way",
    description:
      "Equal by default, or exact amounts, percentages, or shares when the bill wasn't fifty-fifty.",
  },
  {
    icon: BanknoteArrowUp,
    title: "Any currency",
    description:
      "Record expenses and settlements in whatever currency you paid in. Tab converts at the rate for that day.",
  },
  {
    icon: CalendarClock,
    title: "Recurring bills",
    description:
      "Rent, utilities, and subscriptions post on schedule: weekly, monthly, or chosen weekdays. Pause anytime.",
  },
  {
    icon: Zap,
    title: "Real-time sync",
    description:
      "Push notifications when someone adds an expense or settles up, showing who actually paid.",
  },
  {
    icon: BellRing,
    title: "Payment reminders",
    description:
      "Owed money on a one-on-one tab? Send a reminder and pick the tone, from a gentle nudge to unmistakably clear.",
  },
  {
    icon: UserRound,
    title: "Placeholder friends",
    description:
      "Split with people who haven't joined yet. Merge them into their real account later in one step.",
  },
  {
    icon: QrCode,
    title: "QR and link invites",
    description:
      "Add friends or pull people into a tab with a QR code or a shareable link. No usernames to hunt down.",
  },
  {
    icon: Download,
    title: "Splitwise import",
    description:
      "Bring your history with you. Import a Splitwise CSV export and pick up where you left off.",
  },
  {
    icon: Link2,
    title: "1-on-1 with group context",
    description:
      "See the group tabs you share with a friend, and each net balance, right from their page.",
  },
  {
    icon: MessageCircle,
    title: "Emoji reactions",
    description:
      'Drop a quick "thanks" on an expense, or call out that suspiciously expensive dinner.',
  },
  {
    icon: Shuffle,
    title: "Simplified debts",
    description:
      "Tab works out the fewest payments needed to settle a group, so nobody pays three people when one transfer will do.",
  },
  {
    icon: Search,
    title: "Search every expense",
    description:
      "Find that one dinner from March in seconds. Search across a tab's expenses and settlements.",
  },
  {
    icon: History,
    title: "Full edit history",
    description:
      "Every change to an expense is logged: who edited it, what changed, and when. No more silent edits.",
  },
  {
    icon: KeyRound,
    title: "No passwords",
    description:
      "Sign in with a one-time code sent to your email. Nothing to remember, nothing to leak.",
  },
  {
    icon: Monitor,
    title: "Every device",
    description:
      "Install on iPhone, Android, or desktop from the browser. One account, always in sync.",
  },
] as const;

const useCases = [
  {
    icon: Home,
    title: "Roommates",
    description:
      "Rent, utilities, groceries, and that shared Costco run. Set recurring bills once and stop chasing people.",
  },
  {
    icon: Plane,
    title: "Trips and travel",
    description:
      "Log costs in local currency as you go. Tab converts everything so the group settles up in one currency.",
  },
  {
    icon: Heart,
    title: "Couples",
    description:
      "Split the everyday stuff fairly without keeping score in your head. Uneven splits when incomes differ.",
  },
  {
    icon: PartyPopper,
    title: "Friends and events",
    description:
      "Dinners, birthdays, bachelor parties, festival tickets. Add people with a QR code, even before they sign up.",
  },
] as const;

const steps = [
  {
    icon: Users,
    title: "Create a tab",
    description:
      "Start a group for your apartment or trip, or a one-on-one tab with a friend. Invite with a link or QR code.",
  },
  {
    icon: ReceiptText,
    title: "Add expenses",
    description:
      "Type it in or just say it. Split equally or exactly how it happened, in any currency.",
  },
  {
    icon: Wallet,
    title: "Settle up",
    description:
      "Tab keeps a live balance of who owes whom. Record a payment when you settle and everyone sees it instantly.",
  },
] as const;

const switchSteps = [
  {
    icon: FileDown,
    title: "Export from Splitwise",
    description: "Download your expenses as a CSV from Splitwise.",
  },
  {
    icon: Upload,
    title: "Import into Tab",
    description: "Upload the file. Your expense history comes along.",
  },
  {
    icon: UserPlus,
    title: "Invite your people",
    description: "Share a link or QR code and keep splitting, without limits.",
  },
] as const;

const openSourcePoints = [
  {
    icon: Code2,
    title: "Read every line",
    description:
      "No black boxes. Audit exactly how your balances are calculated and what happens to your data.",
  },
  {
    icon: Server,
    title: "Host it yourself",
    description:
      "Run Tab on your own server and your financial data never leaves your infrastructure.",
  },
  {
    icon: ShieldCheck,
    title: "No rug pulls",
    description:
      "Nobody can paywall a feature you depend on. If the hosted version ever went away, the code stays.",
  },
  {
    icon: GitFork,
    title: "Shape what's next",
    description:
      "Open an issue, suggest a feature, or send a pull request. Tab is built in public.",
  },
] as const;

const heroExpenses = [
  {
    label: "Groceries",
    amount: "$94.00",
    paidBy: "You",
    paidById: "hero-you",
    yourShare: "$47.00",
    timeAgo: "2h ago",
    owed: true,
  },
  {
    label: "Thai takeout",
    amount: "$52.00",
    paidBy: "Alex K",
    paidById: "hero-alex",
    yourShare: "$26.00",
    timeAgo: "Yesterday",
    owed: false,
  },
  {
    label: "Electricity",
    amount: "$118.00",
    paidBy: "You",
    paidById: "hero-you",
    yourShare: "$59.00",
    timeAgo: "Mar 19",
    owed: true,
  },
];

function HeroPreview() {
  const y = useMotionValue(0);
  const springY = useSpring(y, { stiffness: 100, damping: 30 });

  return (
    <motion.div
      className="relative mx-auto mt-20 w-full max-w-[300px]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      onMouseEnter={() => y.set(-4)}
      onMouseLeave={() => y.set(0)}
      style={{ y: springY }}
    >
      <motion.div
        className="absolute -inset-8 rounded-3xl bg-primary/6 blur-3xl"
        animate={{ opacity: [0.5, 0.8, 0.5], scale: [1, 1.02, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* Phone shell */}
      <div className="relative overflow-hidden rounded-[2.25rem] border-[3px] border-foreground/10 bg-[#0d0e10] shadow-2xl shadow-black/40">
        {/* Status bar */}
        <div className="flex items-center justify-between px-5 pt-3 pb-1">
          <span className="text-[10px] font-semibold text-white/80">9:41</span>
          <div className="h-3 w-14 rounded-full bg-white/10" />
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-3 rounded-sm bg-white/30" />
            <div className="h-1.5 w-1.5 rounded-full bg-white/30" />
          </div>
        </div>

        {/* Top navbar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.3 }}
          className="flex items-center justify-between px-3 py-2.5"
        >
          <div className="flex items-center gap-2 min-w-0">
            <ChevronLeft className="h-4 w-4 shrink-0 text-primary" />
            <BanknoteArrowUp className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm font-semibold text-white truncate">
              Apartment
            </span>
            <div className="h-2 w-2 rounded-full bg-positive" />
          </div>
          <Settings className="h-4 w-4 shrink-0 text-white/40" />
        </motion.div>

        {/* Content */}
        <div className="space-y-3 px-3 pb-3 text-left">
          {/* Action buttons */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.3 }}
            className="flex gap-2"
          >
            <div className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white/70">
              <Users className="h-3 w-3" />
              Members
            </div>
            <div className="flex items-center gap-1.5 rounded-md bg-positive px-3 py-1.5 text-xs font-semibold text-white">
              <Wallet className="h-3 w-3" />
              Settle
            </div>
          </motion.div>

          {/* Balances */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.3 }}
          >
            <p className="mb-1.5 text-sm font-semibold text-white">Balances</p>
            <div className="rounded-lg bg-white/5 p-3 space-y-2">
              <p className="text-xs font-semibold text-positive">
                You are owed $22.50
              </p>
              <div className="flex items-center gap-1.5 text-[11px] text-white/50">
                <UserAvatar userId="hero-alex" size="xs" />
                <span>Alex K owes $22.50</span>
              </div>
            </div>
          </motion.div>

          {/* Expenses */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Expenses</p>
                <p className="text-[10px] text-white/40">
                  All expenses and settlements
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/50">
                <span>All</span>
              </div>
            </div>
            <div className="space-y-2">
              {heroExpenses.map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: 0.85 + i * 0.08,
                    duration: 0.3,
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }}
                  className="rounded-lg bg-white/5 p-3"
                >
                  {/* Row 1: icon + label + amount */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <BanknoteArrowUp className="h-4 w-4 shrink-0 text-negative" />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
                        {item.label}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-white">
                      {item.amount}
                    </span>
                  </div>
                  {/* Row 2: paid by */}
                  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/50">
                    <span>Paid by</span>
                    <UserAvatar userId={item.paidById} size="xs" />
                    <span>{item.paidBy}</span>
                  </div>
                  {/* Row 3: time + your balance */}
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[10px] text-white/40">
                      {item.timeAgo}
                    </span>
                    <span
                      className={`text-[10px] font-semibold tabular-nums ${item.owed ? "text-positive" : "text-negative"}`}
                    >
                      {item.owed ? "You're owed " : "You owe "}
                      {item.yourShare}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom nav */}
        <div className="flex items-center justify-around border-t border-white/5 px-2 py-2 pb-5">
          {[
            { label: "Friends", active: false },
            { label: "Tabs", active: true },
            { label: "plus", active: false },
            { label: "Activity", active: false },
            { label: "Me", active: false },
          ].map((item) =>
            item.label === "plus" ? (
              <div
                key="plus"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary shadow-lg shadow-primary/40"
              >
                <span className="text-base font-light text-white leading-none">
                  +
                </span>
              </div>
            ) : (
              <div
                key={item.label}
                className={`flex flex-col items-center gap-0.5 ${item.active ? "text-primary" : "text-white/30"}`}
              >
                <span className="text-[9px] font-medium">{item.label}</span>
              </div>
            ),
          )}
        </div>
      </div>
    </motion.div>
  );
}

function AnimatedSection({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{
        duration: 0.5,
        delay,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Section({
  id,
  className = "",
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`relative w-screen left-1/2 -ml-[50vw] scroll-mt-24 border-t border-border/30 px-6 py-24 sm:px-8 sm:py-32 lg:px-12 ${className}`}
    >
      {children}
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
}) {
  const centered = align === "center";
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5 }}
      className={centered ? "text-center" : ""}
    >
      <p className="text-xs font-medium uppercase tracking-widest text-primary">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {description ? (
        <p
          className={`mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg ${centered ? "mx-auto" : ""}`}
        >
          {description}
        </p>
      ) : null}
    </motion.div>
  );
}

function PrimaryCta({ children }: { children: React.ReactNode }) {
  return (
    <Button asChild size="lg" className="min-w-[200px]">
      <Link
        href={`${appConfig.pwaUrl}/login`}
        className="inline-flex items-center gap-2"
      >
        {children}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </Button>
  );
}

function GithubCta({ children }: { children: React.ReactNode }) {
  if (!appConfig.githubUrl) return null;
  return (
    <Button variant="outline" size="lg" asChild className="min-w-[180px]">
      <Link
        href={appConfig.githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2"
      >
        <Github className="h-4 w-4" />
        {children}
      </Link>
    </Button>
  );
}

const heroChecks = [
  "Unlimited expenses",
  "No ads",
  "Open source",
  "Imports from Splitwise",
];

function Hero() {
  return (
    <section className="relative w-screen left-1/2 -ml-[50vw] overflow-hidden px-6 pt-28 pb-24 sm:px-8 sm:pt-36 sm:pb-32 lg:px-12">
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 100% 80% at 50% -30%, rgba(94, 106, 210, 0.12), transparent 60%), radial-gradient(ellipse 80% 50% at 100% 50%, rgba(94, 106, 210, 0.06), transparent 50%), radial-gradient(ellipse 80% 50% at 0% 80%, rgba(94, 106, 210, 0.05), transparent 50%)",
        }}
      />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-size-[5rem_5rem] opacity-30 mask-[radial-gradient(ellipse_80%_70%_at_50%_0%,black_40%,transparent_100%)]" />
      <div className="mx-auto max-w-4xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Link
            href={appConfig.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-positive" />
            The open source Splitwise alternative
            <ArrowRight className="h-3 w-3" />
          </Link>
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-6 text-[2.5rem] leading-[1.1] font-bold tracking-[-0.04em] text-foreground sm:text-5xl md:text-[4rem] md:leading-[1.05]"
        >
          Split expenses with friends.{" "}
          <span className="bg-linear-to-r from-primary via-primary to-primary/70 bg-clip-text text-transparent">
            Free, with no limits.
          </span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl"
        >
          Tab tracks shared bills for roommates, trips, couples, and friend
          groups, so everyone knows who owes whom. Every feature is{" "}
          <span className="font-semibold text-foreground">free forever</span>:
          no daily expense cap, no ads, no paid tier.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <PrimaryCta>Start splitting free</PrimaryCta>
          <GithubCta>Self-host on GitHub</GithubCta>
        </motion.div>
        <motion.ul
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.45,
            delay: 0.4,
            ease: [0.25, 0.46, 0.45, 0.94],
          }}
          className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground"
        >
          {heroChecks.map((label) => (
            <li key={label} className="inline-flex items-center gap-1.5">
              <Check className="h-4 w-4 text-positive" />
              {label}
            </li>
          ))}
        </motion.ul>
        <HeroPreview />
      </div>
    </section>
  );
}

const facts = [
  { value: "$0", label: "Every feature, forever" },
  { value: "No cap", label: "Unlimited expenses, tabs, and friends" },
  { value: "100%", label: "Open source and self-hostable" },
  { value: "Any device", label: "iPhone, Android, and desktop" },
];

function WhatIsTab() {
  return (
    <Section className="bg-muted/5">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <AnimatedSection>
          <p className="text-xs font-medium uppercase tracking-widest text-primary">
            What is Tab?
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
            A bill splitting app that stays out of your way
          </h2>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg">
            <strong className="font-semibold text-foreground">Tab</strong> is a
            free, open source expense splitting app and a drop-in alternative to
            Splitwise. Add a shared expense, choose how to split it, and Tab
            keeps a running balance for everyone in the group. When you're
            ready, settle up and start fresh.
          </p>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
            Unlike apps that cap free users at a few expenses a day, Tab has no
            limits and no premium tier. The hosted version at{" "}
            <Link
              href={appConfig.appUrl}
              className="text-foreground underline decoration-dotted underline-offset-4"
            >
              tabit.in
            </Link>{" "}
            is funded by donations, and anyone can run their own copy.
          </p>
        </AnimatedSection>
        <motion.dl
          className="grid grid-cols-2 gap-4"
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
          }}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
        >
          {facts.map((fact) => (
            <motion.div
              key={fact.label}
              variants={staggerChild}
              className="rounded-2xl border border-border/30 bg-card/50 p-6 dark:bg-card/30"
            >
              <dt className="text-sm text-muted-foreground">{fact.label}</dt>
              <dd className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {fact.value}
              </dd>
            </motion.div>
          ))}
        </motion.dl>
      </div>
    </Section>
  );
}

function UseCases() {
  return (
    <Section>
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Who it's for"
          title="For every kind of shared spending"
          description="Whether it's rent with roommates or a week in Lisbon with six friends, Tab keeps the math honest so the friendship doesn't have to."
        />
        <motion.div
          className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.06, delayChildren: 0.1 },
            },
          }}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
        >
          {useCases.map(({ icon: Icon, title, description }) => (
            <motion.div
              key={title}
              variants={staggerChild}
              className="rounded-2xl border border-border/20 bg-card/50 p-6 dark:bg-card/30"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-foreground">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </Section>
  );
}

function HowItWorks() {
  return (
    <Section className="bg-muted/5">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="How it works"
          title="Three steps to never doing the math again"
        />
        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, description }, i) => (
            <motion.li
              key={title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="relative rounded-2xl border border-border/20 bg-card/50 p-7 dark:bg-card/30"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-foreground">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </motion.li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

function Features() {
  return (
    <Section id="features">
      <div className="mx-auto max-w-6xl">
        <SectionHeading
          eyebrow="Features"
          title="Everything you need to split fairly. All of it free."
          description="Voice logging, multi-currency, recurring bills, simplified debts, search, and reminders. No feature is locked, and none ever will be."
        />
        <motion.div
          className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          variants={{
            hidden: { opacity: 0 },
            visible: {
              opacity: 1,
              transition: { staggerChildren: 0.05, delayChildren: 0.1 },
            },
          }}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
        >
          {features.map(({ icon: Icon, title, description }) => (
            <motion.div
              key={title}
              variants={staggerChild}
              className="group rounded-xl border border-border/20 bg-card/50 p-6 transition-all duration-200 hover:border-border/40 hover:bg-card/80 hover:shadow-md dark:bg-card/30 dark:hover:bg-card/50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold text-foreground">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </Section>
  );
}

function ComparisonCell({
  value,
  highlight = false,
}: {
  value: ComparisonValue;
  highlight?: boolean;
}) {
  if (value === true) {
    return (
      <Check
        className={`mx-auto h-5 w-5 ${highlight ? "text-positive" : "text-muted-foreground"}`}
        aria-label="Yes"
      />
    );
  }
  if (value === false) {
    return (
      <X className="mx-auto h-5 w-5 text-muted-foreground/50" aria-label="No" />
    );
  }
  return (
    <span
      className={`text-sm ${highlight ? "font-semibold text-foreground" : "text-muted-foreground"}`}
    >
      {value}
    </span>
  );
}

function Comparison() {
  return (
    <Section id="compare" className="bg-muted/5">
      <div className="mx-auto max-w-4xl">
        <SectionHeading
          eyebrow="Tab vs Splitwise"
          title="The Splitwise alternative without the paywall"
          description="Splitwise's free plan caps how many expenses you can add each day, shows ads, and keeps search and currency conversion for Pro. Tab gives everyone the full app, free."
        />
        <AnimatedSection className="mt-12 overflow-x-auto rounded-2xl border border-border/30 bg-card/50 dark:bg-card/30">
          <table className="w-full min-w-[520px] text-left">
            <caption className="sr-only">
              Feature comparison of Tab, Splitwise free, and Splitwise Pro
            </caption>
            <thead>
              <tr className="border-b border-border/30">
                <th
                  scope="col"
                  className="px-5 py-4 text-sm font-medium text-muted-foreground"
                >
                  Feature
                </th>
                <th
                  scope="col"
                  className="bg-primary/5 px-5 py-4 text-center text-sm font-semibold text-primary"
                >
                  Tab
                </th>
                <th
                  scope="col"
                  className="px-5 py-4 text-center text-sm font-medium text-muted-foreground"
                >
                  Splitwise free
                </th>
                <th
                  scope="col"
                  className="px-5 py-4 text-center text-sm font-medium text-muted-foreground"
                >
                  Splitwise Pro
                </th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr
                  key={row.feature}
                  className="border-b border-border/20 last:border-b-0"
                >
                  <th
                    scope="row"
                    className="px-5 py-4 text-sm font-medium text-foreground"
                  >
                    {row.feature}
                  </th>
                  <td className="bg-primary/5 px-5 py-4 text-center">
                    <ComparisonCell value={row.tab} highlight />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <ComparisonCell value={row.splitwiseFree} />
                  </td>
                  <td className="px-5 py-4 text-center">
                    <ComparisonCell value={row.splitwisePro} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AnimatedSection>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Splitwise details as of October 2026. Pro pricing varies by region;
          check splitwise.com for current plans and limits.
        </p>
      </div>
    </Section>
  );
}

function OpenSource() {
  return (
    <Section id="open-source">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
        <div>
          <SectionHeading
            align="left"
            eyebrow="Open source"
            title="Your expenses. Your server. Your rules."
            description="Commercial apps can change the rules overnight: free tiers shrink, features move behind paywalls, and years of history become leverage. Tab's source code is public, so that can't happen here."
          />
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <GithubCta>View the source</GithubCta>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {openSourcePoints.map(({ icon: Icon, title, description }, i) => (
            <AnimatedSection
              key={title}
              delay={i * 0.06}
              className="rounded-2xl border border-border/20 bg-card/50 p-6 dark:bg-card/30"
            >
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="mt-4 font-semibold text-foreground">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </Section>
  );
}

function SwitchFromSplitwise() {
  return (
    <Section className="bg-muted/5">
      <div className="mx-auto max-w-5xl">
        <SectionHeading
          eyebrow="Switching from Splitwise"
          title="Move over in about two minutes"
          description="Keep your history. Leave the expense limits behind."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {switchSteps.map(({ icon: Icon, title, description }, i) => (
            <AnimatedSection
              key={title}
              delay={i * 0.08}
              className="flex items-start gap-4 rounded-2xl border border-border/20 bg-card/50 p-6 dark:bg-card/30"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </div>
            </AnimatedSection>
          ))}
        </div>
        <div className="mt-10 flex justify-center">
          <PrimaryCta>Import your Splitwise data</PrimaryCta>
        </div>
      </div>
    </Section>
  );
}

function WhyFree() {
  return (
    <Section>
      <AnimatedSection className="mx-auto max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-widest text-primary">
          Why free?
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Because a paywall made me stop logging expenses.
        </h2>
        <div className="mt-6 space-y-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
          <p>
            Splitwise used to be free. Then came a daily expense limit, a
            cooldown timer, and upgrade prompts at exactly the moment you were
            trying to log dinner.
          </p>
          <p>
            It was built for people like college students, travelers, and young
            couples: people who usually aren't flush with cash. The friction got
            so annoying that I stopped logging expenses altogether, lost track,
            and had no idea who owed what.
          </p>
          <p>
            So I built Tab.{" "}
            <span className="font-medium text-foreground">
              I'd rather pay for a server than for a Splitwise subscription.
            </span>{" "}
            It doesn't cost much to run, and I hope it helps you keep your
            shared finances in order, the way it does for my partner and me.
          </p>
          <p>
            -{" "}
            <Link
              href="https://www.parthkoshti.com?ref=tab"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline-offset-4 decoration-dotted hover:underline"
            >
              Parth Koshti
            </Link>
            , creator of Tab
          </p>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href="/blog/why-tab">Read the full story</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/support">Support the project</Link>
          </Button>
        </div>
      </AnimatedSection>
    </Section>
  );
}

function Faq() {
  return (
    <Section id="faq" className="bg-muted/5">
      <div className="mx-auto max-w-3xl">
        <SectionHeading eyebrow="FAQ" title="Frequently asked questions" />
        <AnimatedSection className="mt-12">
          <div className="divide-y divide-border/30 rounded-2xl border border-border/30 bg-card/50 px-6 dark:bg-card/30">
            {faqs.map((faq) => (
              <details key={faq.question} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-base font-medium text-foreground [&::-webkit-details-marker]:hidden">
                  <h3>{faq.question}</h3>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="pb-5 text-base leading-relaxed text-muted-foreground">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </AnimatedSection>
      </div>
    </Section>
  );
}

function FinalCta() {
  return (
    <Section>
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 100%, rgba(94, 106, 210, 0.1), transparent 70%)",
        }}
      />
      <AnimatedSection className="mx-auto max-w-xl text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
          Free. Forever.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
          No trial. No credit card. No plan to upgrade to. The moment logging an
          expense costs you something, you stop doing it, so it never will.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <PrimaryCta>Start splitting free</PrimaryCta>
          <GithubCta>Star on GitHub</GithubCta>
        </div>
      </AnimatedSection>
    </Section>
  );
}

export function HomePageContent() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const id = window.setTimeout(() => {
      document.getElementById(hash.slice(1))?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <>
      <Hero />
      <WhatIsTab />
      <UseCases />
      <HowItWorks />
      <Features />
      <Comparison />
      <OpenSource />
      <SwitchFromSplitwise />
      <WhyFree />
      <Faq />
      <FinalCta />
    </>
  );
}
