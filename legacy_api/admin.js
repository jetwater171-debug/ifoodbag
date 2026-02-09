const handler = require('./admin/[...path].js');

module.exports = async (req, res) => {
    const query = req.query || {};
    const pathFromQuery = query.path || query.route || '';

    if (!query.path && pathFromQuery) {
        req.query = {
            ...query,
            path: pathFromQuery
        };
    }

    return handler(req, res);
};
