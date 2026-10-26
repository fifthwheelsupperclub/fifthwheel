// Visible FAQ copy, reused as FAQPage JSON-LD (HTML stripped in landing.astro).
export interface FaqItem {
  question: string;
  answers: string[];
}

export const faqs: FaqItem[] = [
  {
    question: "When does Fifth Wheel launch in Atlanta?",
    answers: [
      "Fifth Wheel starts in Atlanta. We seat a table when the five people are right, not on a date we have published.",
    ],
  },
  {
    question: "How does Fifth Wheel decide who sits at my table?",
    answers: [
      "Tables are intentionally curated rather than randomly assigned. A Fifth Wheel coordinator considers things like your date of birth, the ages you want to meet, availability, preferred neighborhood, and the overall conversational balance of the group. There’s no promise you’ll be attracted to anyone but the goal is to create a table worth showing up for.",
    ],
  },
  {
    question: "What ages can participate?",
    answers: [
      "Fifth Wheel is for adults 21 or older. You tell us your date of birth and the youngest and oldest ages you want to meet. We seat people whose ages fall inside each other’s range.",
    ],
  },
  {
    question: "Is it awkward to be the “Fifth Wheel”?",
    answers: [
      "Everyone is the fifth wheel. You’re not walking into someone else’s date. You’re joining four other people who showed up for the same reason: to meet someone new. There’s a little uncertainty built into the night, and that’s part of the fun. Fifth Wheel is designed to make that edge feel playful, social, and low pressure.",
    ],
  },
  {
    question: "When do I vote and what happens?",
    answers: [
      "The current trigger for voting is 90 minutes after the event begins. You privately indicate who, if anyone, you’d like to share dessert with. Your vote stays anonymous unless the interest is mutual. If you match, Fifth Wheel introduces the two of you. If you don’t, nobody at the table learns how you voted.",
    ],
  },
  {
    question: "What if I don’t like anyone at my table?",
    answers: [
      "There is no obligation to make a connection that isn’t there. You still met four new people, experienced several local venues, and hopefully had a good dinner.",
    ],
  },
  {
    question: "How does booking work?",
    answers: [
      "A person approves a table before anyone is invited. An invitation names the date, the neighborhood, and a link to pay.",
      "Accept and pay to confirm your spot. Invitations do not expire.",
    ],
  },
  {
    question: "What does my $25 reservation actually include and what do I pay for that night?",
    answers: [
      "The $25 fee covers curation, identity verification, coordination with the venues, reserved space, and the Fifth Wheel experience, including voting. Food and drinks aren’t included; everyone pays their own restaurant/bar tabs, tax, gratuity, transportation, and parking.",
    ],
  },
  {
    question: "What if I feel uncomfortable or someone behaves inappropriately?",
    answers: [
      "If you feel uncomfortable or unsafe, you may leave the experience at any time. If you believe you are in immediate danger, call 911 or local emergency services.",
      "All participants are required to complete identity verification. Verification confirms biometric selfies to video. This is not a criminal background check, sex offender registry search, or assessment of a participant’s character, intentions, or safety.",
    ],
  },
  {
    question: "How do I provide feedback?",
    answers: [
      "At the end of the evening each guest will receive a short survey. We’d love to hear what worked, what didn’t, and anything that could make your next Fifth Wheel experience even better.",
      'You can also reach out to us directly anytime at <a href="mailto:hello@fifthwheel.community">hello@fifthwheel.community</a>. If you have a concern during an evening, please contact your Fifth Wheel coordinator directly.',
    ],
  },
];
