import { useDeferredValue, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

type ScenarioPlaytime = {
  name: string
  totalSeconds: number
  attemptCount: number
}

type PlaylistPlaytime = {
  name: string
  totalSeconds: number
  matchedScenarios: number
  totalScenarios: number
}

type PlaytimeSummary = {
  totalSeconds: number
  attemptCount: number
  skippedFiles: number
  lastAttemptAt?: number | null
  sourcePath: string
  scenarios: ScenarioPlaytime[]
  playlists: PlaylistPlaytime[]
}

function formatDuration(totalSeconds: number): string {
  const normalized = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(normalized / 3600)
  const minutes = Math.floor((normalized % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function formatTimestamp(timestamp?: number | null): string {
  if (!timestamp) {
    return 'Unknown'
  }

  return new Date(timestamp * 1000).toLocaleString()
}

function App() {
  const [summary, setSummary] = useState<PlaytimeSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState('')
  const [playlistQuery, setPlaylistQuery] = useState('')
  const [scenarioQuery, setScenarioQuery] = useState('')

  const deferredPlaylistQuery = useDeferredValue(playlistQuery)
  const deferredScenarioQuery = useDeferredValue(scenarioQuery)

  async function loadPlaytime(showSpinner = true) {
    if (showSpinner) {
      setIsLoading(true)
    }

    try {
      const nextSummary = await invoke<PlaytimeSummary>('get_kovaak_playtime')
      setSummary(nextSummary)
      setStatusMessage('')
    } catch (error) {
      setStatusMessage(`Failed to read KovaaK playtime: ${String(error)}`)
    } finally {
      if (showSpinner) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    void loadPlaytime()

    const timer = window.setInterval(() => {
      void loadPlaytime(false)
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  async function handleQuit() {
    await invoke('request_app_quit')
  }

  const normalizedPlaylistQuery = deferredPlaylistQuery.trim().toLowerCase()
  const normalizedScenarioQuery = deferredScenarioQuery.trim().toLowerCase()
  const filteredPlaylists = summary
    ? summary.playlists.filter((playlist) => playlist.name.toLowerCase().includes(normalizedPlaylistQuery))
    : []
  const filteredScenarios = summary
    ? summary.scenarios.filter((scenario) => scenario.name.toLowerCase().includes(normalizedScenarioQuery))
    : []

  return (
    <main className="app">
      <section className="hero">
        <p className="eyebrow">Actual KovaaK Playtime</p>
        <div className="hours">
          <span className="value">{summary ? formatDuration(summary.totalSeconds) : '--'}</span>
        </div>
        <p className="subtle">
          {summary
            ? `${formatDuration(summary.totalSeconds)} summed from KovaaK stats CSV files`
            : 'Reading KovaaK stats CSV files'}
        </p>
      </section>

      <section className="details">
        <div className="detail">
          <span className="label">Last attempt</span>
          <strong>{summary ? formatTimestamp(summary.lastAttemptAt) : 'Loading...'}</strong>
        </div>

        <div className="detail">
          <span className="label">Tracked runs</span>
          <strong>
            {summary
              ? `${summary.attemptCount} CSV files${summary.skippedFiles ? `, ${summary.skippedFiles} skipped` : ''}`
              : 'Loading...'}
          </strong>
        </div>

        <div className="detail">
          <span className="label">Source folder</span>
          <span className="mono">{summary?.sourcePath ?? 'Looking for KovaaK stats folder...'}</span>
        </div>
      </section>

      <section className="details table-card">
        <div className="detail">
          <span className="label">Per playlist time</span>
          <span className="subtle">
            Summed from the scenarios currently listed in each KovaaK playlist file.
          </span>
        </div>
        <input
          className="search-input"
          type="search"
          value={playlistQuery}
          onChange={(event) => setPlaylistQuery(event.target.value)}
          placeholder="Search playlists"
        />
        {summary ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Playlist</th>
                  <th>Time</th>
                  <th>Matched</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlaylists.length > 0 ? (
                  filteredPlaylists.map((playlist) => (
                    <tr key={playlist.name}>
                      <td>{playlist.name}</td>
                      <td>{formatDuration(playlist.totalSeconds)}</td>
                      <td>{`${playlist.matchedScenarios}/${playlist.totalScenarios}`}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="empty-row">
                      No matching playlists.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <span>Loading...</span>
        )}
      </section>

      <section className="details table-card">
        <div className="detail">
          <span className="label">Per scenario time</span>
        </div>
        <input
          className="search-input"
          type="search"
          value={scenarioQuery}
          onChange={(event) => setScenarioQuery(event.target.value)}
          placeholder="Search scenarios"
        />
        {summary ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Time</th>
                  <th>Runs</th>
                </tr>
              </thead>
              <tbody>
                {filteredScenarios.length > 0 ? (
                  filteredScenarios.map((scenario) => (
                    <tr key={scenario.name}>
                      <td>{scenario.name}</td>
                      <td>{formatDuration(scenario.totalSeconds)}</td>
                      <td>{scenario.attemptCount}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="empty-row">
                      No matching scenarios.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <span>Loading...</span>
        )}
      </section>

      {statusMessage && (
        <section className="details error-card">
          <div className="detail">
            <span className="label">Read error</span>
            <span>{statusMessage}</span>
          </div>
        </section>
      )}

      <footer className="footer">
        <button onClick={() => void loadPlaytime()} disabled={isLoading}>
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
        <button className="secondary" onClick={() => void handleQuit()} disabled={isLoading}>
          Quit App
        </button>
      </footer>
    </main>
  )
}

export default App
