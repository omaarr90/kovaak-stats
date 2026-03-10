import DataTable, { type DataTableColumn } from '../components/primitives/DataTable'
import EmptyState from '../components/primitives/EmptyState'
import PanelCard from '../components/primitives/PanelCard'
import SectionHeader from '../components/primitives/SectionHeader'
import { formatDuration } from '../playtime-utils'
import { type PlaytimeSummary } from '../types'

type BreakdownsViewProps = {
  summary: PlaytimeSummary | null
  playlistQuery: string
  scenarioQuery: string
  filteredPlaylists: PlaytimeSummary['playlists']
  filteredScenarios: PlaytimeSummary['scenarios']
  onPlaylistQueryChange: (next: string) => void
  onScenarioQueryChange: (next: string) => void
}

const PLAYLIST_COLUMNS: DataTableColumn<PlaytimeSummary['playlists'][number]>[] = [
  {
    id: 'name',
    header: 'Playlist',
    width: '56%',
    truncate: true,
    render: (playlist) => playlist.name,
    title: (playlist) => playlist.name,
  },
  {
    id: 'time',
    header: 'Time',
    width: '20%',
    render: (playlist) => formatDuration(playlist.totalSeconds),
  },
  {
    id: 'matched',
    header: 'Matched',
    width: '24%',
    align: 'right',
    render: (playlist) => `${playlist.matchedScenarios}/${playlist.totalScenarios}`,
  },
]

const SCENARIO_COLUMNS: DataTableColumn<PlaytimeSummary['scenarios'][number]>[] = [
  {
    id: 'name',
    header: 'Scenario',
    width: '56%',
    truncate: true,
    render: (scenario) => scenario.name,
    title: (scenario) => scenario.name,
  },
  {
    id: 'time',
    header: 'Time',
    width: '20%',
    render: (scenario) => formatDuration(scenario.totalSeconds),
  },
  {
    id: 'runs',
    header: 'Runs',
    width: '24%',
    align: 'right',
    render: (scenario) => scenario.attemptCount,
  },
]

function BreakdownsView({
  summary,
  playlistQuery,
  scenarioQuery,
  filteredPlaylists,
  filteredScenarios,
  onPlaylistQueryChange,
  onScenarioQueryChange,
}: BreakdownsViewProps) {
  return (
    <div className="view-shell">
      <div className="panel-grid-two">
        <PanelCard>
          <SectionHeader
            title="Per Playlist Time"
            description="Summed from scenarios currently listed in each KovaaK playlist file."
          />

          <input
            className="search-input"
            type="search"
            value={playlistQuery}
            onChange={(event) => onPlaylistQueryChange(event.target.value)}
            placeholder="Search playlists"
            aria-label="Search playlists"
          />

          {summary ? (
            <DataTable
              columns={PLAYLIST_COLUMNS}
              rows={filteredPlaylists}
              rowKey={(playlist) => playlist.name}
              emptyMessage="No matching playlists."
            />
          ) : (
            <EmptyState title="Loading playlist data..." description="Reading KovaaK stats CSV files." />
          )}
        </PanelCard>

        <PanelCard>
          <SectionHeader title="Per Scenario Time" />

          <input
            className="search-input"
            type="search"
            value={scenarioQuery}
            onChange={(event) => onScenarioQueryChange(event.target.value)}
            placeholder="Search scenarios"
            aria-label="Search scenarios"
          />

          {summary ? (
            <DataTable
              columns={SCENARIO_COLUMNS}
              rows={filteredScenarios}
              rowKey={(scenario) => scenario.name}
              emptyMessage="No matching scenarios."
            />
          ) : (
            <EmptyState title="Loading scenario data..." description="Reading KovaaK stats CSV files." />
          )}
        </PanelCard>
      </div>
    </div>
  )
}

export default BreakdownsView
