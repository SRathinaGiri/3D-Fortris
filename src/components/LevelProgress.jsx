import PropTypes from 'prop-types';

function LevelProgress({ level, lines }) {
  const toNext = Math.max(0, 5 - (lines % 5));
  return (
    <section className="panel">
      <header>
        <h3>Progress</h3>
        <p>Reach new levels every five cleared layers.</p>
      </header>
      <div className="progress">
        <div className="progress__fill" style={{ width: `${(100 * (5 - toNext)) / 5}%` }} />
      </div>
      <p>
        Level {level} &bull; {toNext === 0 ? 'Level up imminent!' : `${toNext} layers to next level`}
      </p>
    </section>
  );
}

LevelProgress.propTypes = {
  level: PropTypes.number.isRequired,
  lines: PropTypes.number.isRequired,
};

export default LevelProgress;
