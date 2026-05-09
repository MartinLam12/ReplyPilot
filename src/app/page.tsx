import Link from "next/link";
import { Button } from "@/components/ui";
import {
  ArrowRight,
  Mail,
  Users,
  Zap,
  Clock,
  CheckCircle2,
  MessageSquare,
  CalendarCheck,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <CTASection />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="gradient-subtle">
        <div className="container-wide py-20 md:py-32">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-50 border border-brand-200 text-brand-700 text-sm font-medium mb-6">
              <Zap className="w-4 h-4" />
              Built for boxing gyms
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-display-xl font-bold text-surface-900 tracking-tight mb-6 leading-tight">
              Stop losing members to{" "}
              <span className="text-brand-600">unanswered emails</span>
            </h1>
            <p className="text-lg md:text-body-xl text-surface-500 max-w-2xl mx-auto mb-10 leading-relaxed">
              AI-powered email replies and automatic post-class follow-ups —
              so you can focus on coaching, not your inbox.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/signup">
                <Button size="lg" icon={<ArrowRight className="w-5 h-5" />}>
                  Get Started Free
                </Button>
              </Link>
              <Link href="/login">
                <Button variant="outline" size="lg">
                  Log In
                </Button>
              </Link>
            </div>
            <div className="flex items-center justify-center gap-6 mt-8 text-sm text-surface-500">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-brand-500" />
                Free to use
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-brand-500" />
                No credit card
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-brand-500" />
                2 locations supported
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    {
      icon: MessageSquare,
      title: "AI Email Replies",
      description:
        "Paste any inquiry — membership, pricing, schedule — and get a professional, gym-branded reply in seconds.",
    },
    {
      icon: CalendarCheck,
      title: "Post-Class Follow-Ups",
      description:
        "Log a class and instantly generate a follow-up email to every attendee. Keep them coming back.",
    },
    {
      icon: Clock,
      title: "Save Hours Every Week",
      description:
        "The average gym owner spends 5+ hours a week on emails. Cut that down to minutes.",
    },
    {
      icon: Users,
      title: "Two Locations",
      description:
        "Manage emails and classes across both your gym locations from one simple dashboard.",
    },
  ];

  return (
    <section id="features" className="py-20 bg-white">
      <div className="container-wide">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-surface-900 mb-4">
            Everything your gym needs
          </h2>
          <p className="text-surface-500 max-w-xl mx-auto">
            Two tools, built specifically for boxing gyms.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((f) => (
            <div
              key={f.title}
              className="p-6 rounded-2xl border border-surface-100 hover:border-brand-200 hover:shadow-soft transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-brand-600" />
              </div>
              <h3 className="font-semibold text-surface-900 mb-2">{f.title}</h3>
              <p className="text-sm text-surface-500 leading-relaxed">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    {
      step: "1",
      title: "Paste an email",
      description: "Copy an incoming inquiry and paste it into the inbox tool.",
    },
    {
      step: "2",
      title: "Get an AI draft",
      description:
        "Click 'Draft Reply' — AI writes a professional reply in your gym's voice.",
    },
    {
      step: "3",
      title: "Send it",
      description:
        "Edit if needed, then open in Gmail with one click and hit send.",
    },
  ];

  return (
    <section id="how-it-works" className="py-20 bg-surface-50">
      <div className="container-wide">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-surface-900 mb-4">How it works</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          {steps.map((s) => (
            <div key={s.step} className="text-center">
              <div className="w-12 h-12 rounded-full gradient-brand flex items-center justify-center mx-auto mb-4">
                <span className="text-white font-bold text-lg">{s.step}</span>
              </div>
              <h3 className="font-semibold text-surface-900 mb-2">{s.title}</h3>
              <p className="text-sm text-surface-500 leading-relaxed">{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="py-20 bg-white">
      <div className="container-wide">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-surface-900 mb-4">
            Ready to take back your time?
          </h2>
          <p className="text-surface-500 mb-8">Set up in under 5 minutes. No credit card required.</p>
          <Link href="/signup">
            <Button size="lg" icon={<Mail className="w-5 h-5" />}>
              Start Replying Smarter
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
