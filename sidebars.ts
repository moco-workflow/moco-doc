import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  // By default, Docusaurus generates a sidebar from the docs folder structure
  tutorialSidebar: [
    {
      type: 'category',
      label: 'Introduction',
      items: ['intro', 'quick-start'],
    },
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'concepts/overview',
        'concepts/dual-runtime',
        'concepts/workflowspec',
        'concepts/expressions',
        'concepts/activities',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      items: [
        'reference/workflowspec',
        'reference/statements',
        'reference/state-machines',
        'reference/events',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/development-setup',
        'guides/writing-workflows',
        'guides/creating-activities',
        'guides/testing',
      ],
    },
  ],
};

export default sidebars;
