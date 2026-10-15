const Service      = require('../models/Service');
const User         = require('../models/User');
const notifService = require('../services/notificationService');

exports.getServices = async (req, res, next) => {
  try {
    const services = await Service.find()
      .populate('createdBy', 'name')
      .sort({ category: 1, name: 1 });
    res.json({ success: true, data: services });
  } catch (err) { next(err); }
};

exports.createService = async (req, res, next) => {
  try {
    const { name, description, category, color, icon } = req.body;
    const service = await Service.create({
      name, description, category, color, icon,
      createdBy: req.user._id,
    });
    const populated = await service.populate('createdBy', 'name');
    res.status(201).json({ success: true, data: populated });

    // Notify all users except the admin who created it
    const io = req.app.get('io');
    const allUsers = await User.find({ _id: { $ne: req.user._id } }, '_id');
    allUsers.forEach((u) => {
      notifService.dispatch(io, {
        recipient: u._id,
        sender:    req.user._id,
        type:      'service_added',
        title:     'New Service Added',
        message:   `${req.user.name} added a new service: ${name}`,
        link:      '/settings',
      });
    });
  } catch (err) { next(err); }
};

exports.updateService = async (req, res, next) => {
  try {
    // Whitelisted rather than passing req.body through, which let a caller
    // overwrite createdBy/timestamps or any other schema path.
    const SERVICE_WRITABLE = ['name', 'description', 'category', 'color', 'icon', 'isActive'];
    const patch = SERVICE_WRITABLE.reduce((acc, k) => {
      if (req.body[k] !== undefined) acc[k] = req.body[k];
      return acc;
    }, {});

    const service = await Service.findByIdAndUpdate(
      req.params.id,
      patch,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name');
    if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
    res.json({ success: true, data: service });
  } catch (err) { next(err); }
};

exports.deleteService = async (req, res, next) => {
  try {
    const service = await Service.findByIdAndDelete(req.params.id);
    if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
    res.json({ success: true, message: 'Service deleted' });
  } catch (err) { next(err); }
};
