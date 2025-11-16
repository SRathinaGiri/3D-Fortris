import PropTypes from 'prop-types';

const VIEW_MODES = [
  { value: 'perspective', label: '3D Perspective' },
  { value: 'top', label: '2D Top View' },
  { value: 'cross', label: 'Cross View' },
  { value: 'parallel', label: 'Parallel View' },
  { value: 'anaglyph', label: 'Anaglyph View' },
  { value: 'stereo', label: 'Stereo 3D' },
];

function ControlPanel({ viewType, stereoSettings, onViewChange, onStereoChange, message }) {
  return (
    <section className="panel">
      <header>
        <h3>Visual Settings</h3>
      </header>
      <label htmlFor="viewMode">View Mode</label>
      <select id="viewMode" value={viewType} onChange={(e) => onViewChange(e.target.value)}>
        {VIEW_MODES.map((mode) => (
          <option key={mode.value} value={mode.value}>
            {mode.label}
          </option>
        ))}
      </select>

      {viewType === 'stereo' && (
        <div className="stereo-grid">
          <label htmlFor="eyeDistance">
            Eye distance
            <span>{stereoSettings.eyeDistance.toFixed(2)}m</span>
          </label>
          <input
            id="eyeDistance"
            type="range"
            min="0.02"
            max="0.12"
            step="0.005"
            value={stereoSettings.eyeDistance}
            onChange={(e) => onStereoChange({ eyeDistance: Number(e.target.value) })}
          />

          <label htmlFor="focusDepth">
            Focus depth
            <span>{stereoSettings.focusDepth.toFixed(1)}m</span>
          </label>
          <input
            id="focusDepth"
            type="range"
            min="1"
            max="15"
            step="0.5"
            value={stereoSettings.focusDepth}
            onChange={(e) => onStereoChange({ focusDepth: Number(e.target.value) })}
          />

          <label htmlFor="fov">
            Field of View
            <span>{stereoSettings.fov}&deg;</span>
          </label>
          <input
            id="fov"
            type="range"
            min="35"
            max="110"
            value={stereoSettings.fov}
            onChange={(e) => onStereoChange({ fov: Number(e.target.value) })}
          />
        </div>
      )}

      {message && <p className="panel__message">{message}</p>}
    </section>
  );
}

ControlPanel.propTypes = {
  viewType: PropTypes.string.isRequired,
  stereoSettings: PropTypes.shape({
    eyeDistance: PropTypes.number,
    focusDepth: PropTypes.number,
    fov: PropTypes.number,
  }).isRequired,
  onViewChange: PropTypes.func.isRequired,
  onStereoChange: PropTypes.func.isRequired,
  message: PropTypes.string,
};

ControlPanel.defaultProps = {
  message: '',
};

export default ControlPanel;
