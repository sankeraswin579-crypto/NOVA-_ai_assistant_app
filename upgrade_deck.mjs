import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtimeRoot = 'C:/Users/ASWIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const skillDir = 'C:/Users/ASWIN/.codex/plugins/cache/openai-primary-runtime/presentations/26.1025.11240/skills/presentations';
const workspaceDir = 'D:/Documents/nova-ai-desktop';
const sourcePath = path.join(workspaceDir, 'aswin.s.source.pptx');
const tmpDir = path.join(workspaceDir, '.codex-build');
const finalPath = path.join(workspaceDir, 'output', 'aswin.s.upgraded.v3.pptx');

const { FileBlob, PresentationFile } = await import(pathToFileURL(runtimeRoot).href);
process.env.RUNTIME_NODE_MODULES = 'C:/Users/ASWIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const presentation = await PresentationFile.importPptx(await FileBlob.load(sourcePath));

const legends = {
  1: [
    '1. Main Project Search Card',
    '2. Project Summary Cards Container',
    '3. Reusable Summary Card',
    '4. Project Category Filter Bar',
    '5. Filter Button',
    '6. Project Results Section',
    '7. SkillBuster Brand Header',
    '8. Project Search Bar',
    '9. Home Navigation Item',
    '10. Chats Navigation Item',
    '11. Notification Badge',
  ].join('\n'),
  2: [
    '11. Project Results Container',
    '12. Project Title and Description',
    '13. Project Budget',
    '14. Project Metadata',
    '15. Client Profile Card',
    '16. Apply Button',
    '17. Freelancer Profile Header',
    '18. Sign Out Button',
    '19. Freelancer Statistics Container',
    '20. Featured Project Card',
  ].join('\n'),
  3: [
    '21. Dashboard Header Card',
    '22. Online Status Indicator',
    '23. Profile Completion Card',
    '24. Earnings Summary Card',
    '25. Active Orders Summary Card',
    '26. Completed Orders Summary Card',
    '27. Pending Proposals Card',
    '28. Profile Views Summary Card',
    '29. Rating Summary Card',
    '30. Quick Actions Panel',
    '31. Quick Action Button',
    '32. Sidebar Navigation',
    '33. Service Search Bar',
    '34. Dashboard Navigation Item',
  ].join('\n'),
  4: [
    '35. Recent Orders Container',
    '36. Recent Orders Heading',
    '37. View All Button',
    '38. Order Card',
    '39. Order Price',
    '40. Order Status Badge',
    '41. My Gigs Container',
    '42. Manage All Button',
    '43. Empty Gigs State',
    '44. Create Gig Button',
  ].join('\n'),
  5: [
    '45. Back Button',
    '46. Project Overview Header',
    '47. Find a Collaborator Button',
    '48. Project Statistics Container',
    '49. Assigned Projects Card',
    '50. Committed Projects Card',
    '51. Completed Projects Card',
    '52. Active and Delivered Work Section',
    '53. Project Status Label',
    '54. Projects Navigation Heading',
    '55. Project Card',
    '56. Project Status Badge',
    '57. Project Budget',
  ].join('\n'),
  6: [
    '58. Back Button',
    '59. Delivery Desk Header',
    '60. Active Projects Container',
    '61. Active Project Card',
    '62. Project Progress Indicator',
    '63. Delivery Workspace Card',
    '64. Workspace Icon',
    '65. Workspace Description',
    '66. Open Workspace Button',
    '67. Client Chat Button',
  ].join('\n'),
  7: [
    '68. Talent Pool Header',
    '69. Talent Search Bar',
    '70. Matching Talent Count',
    '71. Matched Projects Indicator',
    '72. Talent Profile Card',
    '73. Talent Name and Role',
    '74. Talent Skills',
    '75. View Profile Button',
    '76. Invite Button',
  ].join('\n'),
  8: [
    '77. Back Button',
    '78. Proposals Header Card',
    '79. Proposal Statistics Container',
    '80. Browse Projects Tab',
    '81. Sent Proposals Tab',
    '82. Proposal Filter Container',
    '83. Proposal Search Field',
    '84. Category Filter',
    '85. Budget Filter',
    '86. Skill Filter',
    '87. Proposal Category Badge',
    '88. Submit Proposal Button',
    '89. View Details Button',
    '90. Video Editing Category Badge',
  ].join('\n'),
  9: [
    '91. Navigation Sidebar',
    '92. Back Button',
    '93. Earnings Header Section',
    '94. Withdraw Funds Button',
    '95. Earnings Summary Cards Container',
    '96. Available Balance Card',
    '97. Pending Clearance Card',
    '98. Earned This Month Card',
    '99. Last Month Earnings Card',
    '100. Quick Stats Section',
    '101. Quick Stats Details Card',
    '102. Withdrawal Methods Section',
    '103. PayPal Payment Card',
    '104. Bank Transfer Card',
    '105. Stripe Payment Card',
    '106. Wise Payment Card',
    '107. Profile Sidebar',
  ].join('\n'),
  10: [
    '108. Navigation Sidebar',
    '109. Template Catalog Header Section',
    '110. New Template Button',
    '111. Catalog Navigation Tabs',
    '112. Live Catalog Tab',
    '113. Buyer Details Tab',
    '114. Template Cards Container',
    '115. Launch-Ready Brand Kit Card',
    '116. Figma Handoff Checklist Card',
    '117. UX Research Brief Card',
    '118. Profile Sidebar',
    '119. Your Stats Section',
  ].join('\n'),
};

const slideSize = { width: 1280, height: 720 };
const purple = '#7057E8';
const blue = '#2457D6';

for (let i = 0; i < presentation.slides.items.length; i++) {
  const slide = presentation.slides.items[i];
  const slideNumber = i + 1;
  for (const shape of slide.shapes.items) {
    const text = shape.text?.toString?.() ?? '';
    const position = { ...shape.position };

    // The source rectangles already trace the UI regions. Keep their geometry,
    // but make the outlines a consistent, readable annotation color.
    if (shape.geometry === 'rect' && !text.trim() && shape.name?.startsWith('Rectangle')) {
      shape.fill = 'none';
      shape.line = { style: 'solid', fill: purple, width: 1.8 };
    }

    // Turn existing numeric labels into compact editable callout badges.
    const clean = text.trim().replace(/\.$/, '');
    const isNumericLabel = clean.length > 0 && clean.length <= 3 && Number.isInteger(Number(clean));
    if (isNumericLabel && position.left < 860) {
      if (slideNumber === 1 && clean === '8' && position.left > 100) shape.text = '9';
      if (slideNumber === 6 && clean === '45') shape.text = '58';
      if (slideNumber === 9 && clean === '16') {
        shape.text = '';
        continue;
      }
      if (slideNumber === 9) {
        const map = {
          '4': { label: '96', left: 182, top: 176 },
          '91': { label: '91', left: 8, top: 50 },
          '92': { label: '92', left: 218, top: 32 },
          '93': { label: '93', left: 382, top: 74 },
          '94': { label: '94', left: 650, top: 94 },
          '95': { label: '95', left: 174, top: 165 },
          '96': { label: '98', left: 432, top: 176 },
          '97': { label: '97', left: 307, top: 176 },
          '98': { label: '105', left: 360, top: 414 },
          '99': { label: '99', left: 560, top: 176 },
          '100': { label: '100', left: 180, top: 300 },
          '101': { label: '101', left: 185, top: 330 },
          '102': { label: '102', left: 360, top: 300 },
          '103': { label: '103', left: 360, top: 330 },
          '104': { label: '104', left: 522, top: 330 },
          '105': { label: '106', left: 522, top: 414 },
          '107': { label: '107', left: 697, top: 34 },
        };
        const item = map[clean];
        if (item) {
          shape.text = item.label;
          position.left = item.left;
          position.top = item.top;
        }
      }
      if (slideNumber === 10) {
        const markerMap = { '107': '108', '108': '109', '109': '110', '111': '112', '112': position.left < 220 ? '112' : '113', '113': '114', '114': '115', '115': '116', '116': '117', '17': '118', '19': '119' };
        const current = shape.text.toString().trim().replace(/\.$/, '');
        if (markerMap[current]) shape.text = markerMap[current];
      }
      const updated = shape.text.toString().trim();
      if (!updated) continue;
      shape.geometry = 'roundRect';
      shape.position = {
        left: Math.max(0, position.left),
        top: Math.max(0, position.top),
        width: updated.length === 3 ? 38 : 32,
        height: 25,
      };
      shape.fill = blue;
      shape.line = { style: 'solid', fill: 'none', width: 0 };
      shape.text.insets = 0;
      shape.text.style = {
        fontSize: 13,
        typeface: 'Aptos',
        bold: true,
        color: '#FFFFFF',
        alignment: 'center',
        verticalAlignment: 'middle',
        insets: 0,
      };
    }
  }

  // Replace the original rough key with a clean, corrected, editable component list.
  const key = slide.shapes.items.find((shape) => {
    const text = shape.text?.toString?.() ?? '';
    return shape.position.width > 250 && (text.match(/[0-9]{1,3}\./g) ?? []).length >= 5 && text.includes('\n');
  });
  if (key && legends[slideNumber]) {
    key.text = legends[slideNumber];
    key.text.style = {
      fontSize: 16,
      typeface: 'Aptos',
      color: '#1F2937',
      alignment: 'left',
      verticalAlignment: 'top',
      insets: { left: 0, right: 0, top: 0, bottom: 0 },
    };
  }
}

await fs.mkdir(tmpDir, { recursive: true });
await fs.mkdir(path.dirname(finalPath), { recursive: true });
const previewDir = path.join(tmpDir, 'previews');
await fs.mkdir(previewDir, { recursive: true });
for (let i = 0; i < presentation.slides.items.length; i++) {
  const png = await presentation.slides.items[i].export({ format: 'png', scale: 1 });
  await fs.writeFile(path.join(previewDir, `slide-${String(i + 1).padStart(2, '0')}.png`), new Uint8Array(await png.arrayBuffer()));
}

const { finalizePresentation } = await import(pathToFileURL(path.join(skillDir, 'container_tools/artifact_tool_utils.mjs')).href);
const candidatePath = path.join(workspaceDir, '.codex-finalizer', 'candidate.pptx');
await fs.mkdir(path.dirname(candidatePath), { recursive: true });
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
const result = await finalizePresentation({
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable: 'C:/Users/ASWIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
  integrityValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-heading-fit'],
  explicitTotalSlideCount: 10,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
  fontPolicy: {
    basis: 'reference',
    families: ['Aptos'],
    referencePath: sourcePath,
    referenceSha256: 'f88a69fb0b16413cc3481b8ec3bb7d5c50272e3a670c96ab54da24ca79227428',
  },
  verifyArtifactToolImport: true,
  receiptPath: path.join(workspaceDir, '.codex-finalizer', 'aswin.s.upgraded.v3.validation.json'),
});
console.log(JSON.stringify({ finalPath, result }, null, 2));
