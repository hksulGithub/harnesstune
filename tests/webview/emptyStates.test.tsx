import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentDetail } from '../../src/webview/dashboard/components/AgentDetail';
import { WorkspaceDrillDown } from '../../src/webview/dashboard/components/WorkspaceDrillDown';
import { GraphArea } from '../../src/webview/schematic/components/GraphArea';

describe('empty workspace panels', () => {
  it('renders instructional copy for agents, runs, topology, and schematic empty states', () => {
    const html = renderToStaticMarkup(
      <div>
        <WorkspaceDrillDown
          workspaceName="ws-empty"
          agents={[]}
          cost={{ totalCostUsd: 0, totalTokens: 0, trend: 'flat' }}
          loading={false}
          error={null}
          onSelectAgent={jest.fn()}
        />
        <AgentDetail
          agentName="No Agent"
          workspaceName="ws-empty"
          runs={[]}
          cost={{ totalCostUsd: 0, totalTokens: 0, trend: 'flat' }}
          loading={false}
          error={null}
        />
        <GraphArea
          topology={{ nodes: [], edges: [] }}
          selectedNodeId={null}
          viewTransform={{ x: 0, y: 0, scale: 1 }}
          fitToViewCounter={0}
          onSelectNode={jest.fn()}
          onViewTransformChange={jest.fn()}
        />
      </div>,
    );

    expect(html).toMatchSnapshot();
  });
});
