const pool = require('../db');

/**
 * Middleware factory that verifies req.user is a member of the project
 * identified by req.params.projectId before allowing the request through.
 *
 * Usage:
 *   router.get('/:projectId/resource', authenticate, requireMember(), handler);
 *
 * Optionally restrict to specific roles:
 *   requireMember(['owner', 'editor'])
 */
function requireMember(roles) {
  return async function (req, res, next) {
    const projectId = req.params.projectId;
    if (!projectId) return res.status(400).json({ error: 'Missing projectId' });
    try {
      let query;
      let params;
      if (roles && roles.length > 0) {
        const placeholders = roles.map((_, i) => `$${i + 3}`).join(', ');
        query = `SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 AND role IN (${placeholders})`;
        params = [projectId, req.user.id, ...roles];
      } else {
        query = 'SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2';
        params = [projectId, req.user.id];
      }
      const result = await pool.query(query, params);
      if (result.rowCount === 0) return res.status(403).json({ error: 'Forbidden' });
      next();
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

module.exports = requireMember;
