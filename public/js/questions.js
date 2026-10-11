// The questions. Edit freely: keep 2 to 4 options and point "correct" at the right one
// (0 = first option). The order of the options is shuffled for every game.
export const QUESTIONS = [
  {
    topic: 'From strategy to action',
    scenario: 'You are the CEO of Walmart. Shoppers are moving online, so the board approves a new strategy: become a more digital, omnichannel company. What is your next move?',
    options: [
      'Announce the strategy and wait for the stores to adapt on their own',
      'Decide the money, technology and people needed to make the strategy possible',
      'Close most physical stores this quarter to force the change',
      'Cut every department’s budget by 10% to free up cash',
    ],
    correct: 1,
    why: 'A good strategy is not enough. Implementation prepares what the plan needs (resources, budgets and people) so that execution can start.',
  },
  {
    topic: 'Funding capital projects',
    scenario: 'You can fund only one major project this year. Which one does the most to support an omnichannel strategy?',
    options: [
      'A new corporate headquarters',
      'A large sports sponsorship to raise brand awareness',
      'Supply chain automation and eCommerce infrastructure',
      'Equal funding for every department, as in other years',
    ],
    correct: 2,
    why: 'Capital goes to projects that contribute to the strategy. Walmart directs most of its capital to higher-return areas such as automation, eCommerce and supply chain.',
  },
  {
    topic: 'Competencies and capabilities',
    scenario: 'Your teams now have new AI tools for inventory and customer service, but most employees do not know how to use them. What do you do?',
    options: [
      'Nothing: good tools are intuitive',
      'Train employees so they can use the technology well',
      'Replace the workforce with specialists from outside',
      'Buy more AI tools to cover the gaps',
    ],
    correct: 1,
    why: 'Capabilities are the link between strategy and execution. Invest in people, not only in technology (Wipro trained 200,000 employees in generative AI).',
  },
  {
    topic: 'Shifting resources',
    scenario: 'Returns on new store openings are falling while eCommerce keeps growing. How do you reallocate capital?',
    options: [
      'Move capital away from new stores toward eCommerce, technology and supply chain',
      'Keep funding every area exactly as before',
      'Cut spending across the board to save money',
      'Freeze eCommerce until it becomes more profitable',
    ],
    correct: 0,
    why: 'Resources should follow strategy: downsize the lower-priority area and upsize the strategic one. That is shifting resources, not cost cutting. Walmart cut US new-store capital from $2.17 bn to $0.91 bn while eCommerce, technology and supply chain rose to $4.52 bn.',
  },
  {
    topic: 'Budgets',
    scenario: 'Finance proposes next year’s budget: 90% for physical stores, as usual. Your strategy is to lead in digital. What do you decide?',
    options: [
      'Approve it: stores still generate most of the revenue',
      'Ask every department to cut 5% and keep the same proportions',
      'Rebuild the budget around the strategic priorities',
      'Split the budget equally between all departments',
    ],
    correct: 2,
    why: 'A budget translates strategic priorities into financial decisions. If the money backs one thing and the strategy says another, execution fails.',
  },
  {
    topic: 'Policies',
    scenario: 'You want shopping online to feel effortless. Which policy supports that strategy best?',
    options: [
      'Online purchases can only be returned in a physical store',
      'Returns need a paper form signed by a store manager',
      'Customers can return online purchases digitally within 30 days',
      'Each employee decides case by case, with no common rule',
    ],
    correct: 2,
    why: 'Policies are rules that guide employees’ decisions so they act in line with the strategy. A digital strategy needs digital-friendly rules, applied consistently.',
  },
  {
    topic: 'Rewards',
    scenario: 'How should you design the annual bonus for managers?',
    options: [
      'Reward only the lowest costs',
      'The same bonus for everyone, whatever the results',
      'No bonuses: salaries are enough',
      'Link it to strategic objectives, such as sales and operating income',
    ],
    correct: 3,
    why: 'Rewards must reinforce strategically important performance: what gets rewarded gets attention. Walmart ties its incentive plans to its strategic plan, with sales and operating income as metrics.',
  },
  {
    topic: 'Best practices',
    scenario: 'Online orders are being delivered too slowly. What is the best way to improve?',
    options: [
      'Tell drivers to work faster',
      'Use data and AI to optimize inventory and routes, measure the results and keep improving',
      'Accept slow delivery as normal for online orders',
      'Stop offering same-day delivery',
    ],
    correct: 1,
    why: 'Best practices are the best known ways of doing a task, and they rely on continuous improvement: measure, learn, improve, repeat.',
  },
  {
    topic: 'Support systems',
    scenario: 'Store teams cannot see stock in real time, so online orders keep failing. Where do you invest?',
    options: [
      'Ask employees to count stock by hand every hour',
      'Reduce the range of products sold online',
      'Nowhere: occasional errors are unavoidable',
      'Inventory and data systems that give everyone real-time information',
    ],
    correct: 3,
    why: 'Support systems give employees the information and tools they need: information leads to decisions, actions and results.',
  },
  {
    topic: 'Strategic alignment',
    scenario: 'Your strategy is right but results lag. An audit finds old budgets, outdated policies, weak systems and bonuses that only reward in-store sales. What do you do?',
    options: [
      'Change the strategy again',
      'Blame the employees’ attitude',
      'Hire consultants and leave everything else as it is',
      'Align resources, budgets, policies, systems and rewards with the strategy',
    ],
    correct: 3,
    why: 'Strategy execution needs every element aligned with the strategy. The problem is not always the strategy; sometimes it is how it is executed.',
  },
];
