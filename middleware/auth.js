function checkAdmin(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }
    
    // If request is an API/JSON request, return structured 401
    const isApi = req.xhr || 
                  (req.headers.accept && req.headers.accept.includes('application/json')) || 
                  req.path.startsWith('/api') || 
                  req.baseUrl.includes('/api');

    if (isApi) {
        return res.status(401).json({ 
            success: false, 
            authError: true,
            msg: "સત્ર સમાપ્ત થઈ ગયું છે. કૃપા કરીને ફરીથી લોગિન કરો!" 
        });
    }

    return res.redirect('/admin/login');
}

module.exports = { checkAdmin };

