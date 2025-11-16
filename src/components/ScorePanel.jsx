import PropTypes from 'prop-types';

function ScorePanel({ stats, nextPiece }) {
  return (
    <section className="panel">
      <header>
        <h3>Mission Briefing</h3>
        <p>Clear complete 3D layers to keep the playfield open.</p>
      </header>
      <dl className="stats">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>

      {nextPiece && (
        <div className="next-piece">
          <h4>Next Piece</h4>
          <div className="piece-preview">
            {nextPiece.cells.map((cell) => (
              <span key={`${cell.join('-')}`}>{`■`}</span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

ScorePanel.propTypes = {
  stats: PropTypes.arrayOf(PropTypes.shape({
    label: PropTypes.string,
    value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  })).isRequired,
  nextPiece: PropTypes.shape({
    cells: PropTypes.arrayOf(PropTypes.arrayOf(PropTypes.number)),
  }),
};

ScorePanel.defaultProps = {
  nextPiece: null,
};

export default ScorePanel;
