/**
 * Copyright (c) 2014 brian@bevey.org
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

/**
 * @author brian@bevey.org
 * @fileoverview Record Foscam video and audio to disc, while monitoring and
 *               deleting old files to stay within capacity.
 * @requires fs, child_process
 * @note Huge thanks for the ffmpeg syntax found here:
 *       http://foscam.us/forum/post33382.html#p33382
 * @note Requires the installation of ffmpeg.  You can download a .deb for
 *       Raspbian here:
 *       https://github.com/ccrisan/motioneye/wiki/Install-On-Raspbian
 */

module.exports = (function () {
  'use strict';

  return {
    version : 20161026,

    lastEvents : { space : 0, thumbnail : 0 },

    dvrProcess : null,

    getFilename : function (filename) {
      var validTypes = ['jpg', 'gif', 'mkv'],
          extension  = filename.split('.').pop(),
          clean      = null;

      if (validTypes.indexOf(extension) !== -1) {
        clean = filename.slice(0, -4);
      }

      return clean;
    },

    deleteOldest : function (controller) {
      var fs         = require('fs'),
          runCommand = require(__dirname + '/../lib/runCommand'),
          mkvPath    = 'images/foscam/dvr',
          gifPath    = 'images/foscam/thumb',
          jpgPath    = gifPath,
          filename,
          self       = this;

      fs.readdir(mkvPath, function(err, items) {
        filename = self.getFilename(items[0]);

        if (filename) {
          fs.unlink(mkvPath + '/' + filename + '.mkv');
          fs.unlink(gifPath + '/' + filename + '.gif');
          fs.unlink(jpgPath + '/' + filename + '.jpg');

          runCommand.runCommand(controller.config.deviceId, 'list');

          console.log('\x1b[35m' + controller.config.title + '\x1b[0m: DVR files for ' + filename + ' deleted');
        }
      });
    },

    // My testing has shown about 15MB per minute of video.
    checkDisc : function (controller, byteLimit) {
      var fs         = require('fs'),
          path       = 'images/foscam/dvr',
          totalBytes = 0,
          i          = 0;

      fs.readdir(path, function(err, filenames) {
        for (i; i < filenames.length; i += 1) {
          totalBytes += fs.statSync(path + '/' + filenames[i]).size;

          if (totalBytes >= byteLimit) {
            this.deleteOldest(controller);
            break;
          }
        }
      });
    },

    checkThumbnails : function (controller, thumbByteLimit) {
      var fs   = require('fs'),
          path = 'images/foscam/',
          i    = 0,
          self = this;

      fs.readdir(path + 'dvr', function(err, items) {
        for (i; i < items.length; i += 1) {
          (function (filename) {
            if (filename) {
              fs.stat(path + 'dvr/' + filename + '.mkv', function (err, stats) {
                if (stats.size >= thumbByteLimit) {
                  fs.stat(path + 'thumb/' + filename + '.gif', function (err, stats) {
                    // If we don't have a thumbnail for a video file larger than the
                    // defined threshold, let's generate them.
                    if (!stats) {
                      self.buildThumbnails(controller, filename);
                    }
                  });
                }
              });
            }
          })(self.getFilename(items[i]));
        }
      });
    },

    buildThumbnails : function (controller, filename) {
      var spawn             = require('child_process').spawn,
          runCommand        = require(__dirname + '/../lib/runCommand'),
          screenshotCommand = this.translateScreenshotCommand(filename),
          thumbCommand      = this.translateThumbCommand(filename);

      console.log('\x1b[35m' + controller.config.title + '\x1b[0m: Creating DVR thumbnails for ' + filename);

      runCommand.runCommand(controller.config.deviceId, 'list');

      spawn(screenshotCommand.command, screenshotCommand.params);
      spawn(thumbCommand.command, thumbCommand.params);
    },

    translateScreenshotCommand : function (filename) {
      var input   = 'images/foscam/dvr/' + filename + '.mkv',
          output  = 'images/foscam/thumb/' + filename + '.jpg',
          execute = { command : 'ffmpeg', params : [] };

      execute.params.push('-ss');
      execute.params.push('00:00:15');
      execute.params.push('-i');
      execute.params.push(input);
      execute.params.push('-vframes');
      execute.params.push(1);
      execute.params.push('-q:v');
      execute.params.push('10');
      execute.params.push('-vf');
      execute.params.push('scale=200:-1');
      execute.params.push(output);

      return execute;
    },

    translateThumbCommand : function (filename) {
      var input   = 'images/foscam/dvr/' + filename + '.mkv',
          output  = 'images/foscam/thumb/' + filename + '.gif',
          execute = { command : 'ffmpeg', params : [] };

      execute.params.push('-i');
      execute.params.push(input);
      execute.params.push('-r');
      execute.params.push(1);
      execute.params.push('-filter:v');
      execute.params.push('setpts=0.025*PTS');
      execute.params.push('-vf');
      execute.params.push('scale=200:-1');
      execute.params.push(output);

      return execute;
    },

    translateVideoCommand : function (config, videoLength) {
      var now       = new Date(),
          year      = now.getFullYear(),
          month     = now.getMonth() + 1,
          day       = now.getDate(),
          hour      = now.getHours(),
          minute    = now.getMinutes(),
          videoPath = 'http://' + config.deviceIp + '/videostream.cgi?user=' + config.username + '&pwd=' + config.password,
          audioPath = 'http://' + config.deviceIp + '/videostream.asf?user=' + config.username + '&pwd=' + config.password,
          localPath = 'images/foscam/dvr',
          output    = localPath + '/' + year + '-' + month + '-' + day + '-' + hour + '-' + minute + '-%03d.mkv',
          execute   = { command : 'ffmpeg', params : [] };

      execute.params.push('-use_wallclock_as_timestamps');
      execute.params.push(1);
      execute.params.push('-f');
      execute.params.push('mjpeg');
      execute.params.push('-i');
      execute.params.push(videoPath);
      execute.params.push('-i');
      execute.params.push(audioPath);
      execute.params.push('-map');
      execute.params.push('0:v');
      execute.params.push('-map');
      execute.params.push('1:a');
      execute.params.push('-acodec');
      execute.params.push('copy');
      execute.params.push('-vcodec');
      execute.params.push('copy');
      execute.params.push('-f');
      execute.params.push('segment');
      execute.params.push('-segment_time');
      execute.params.push(videoLength);
      execute.params.push('-reset_timestamps');
      execute.params.push(1);
      execute.params.push(output);

      return execute;
    },

    startDvr : function (controller, videoLength) {
      var spawn       = require('child_process').spawn,
          dvrCommand  = this.translateVideoCommand(controller.config, videoLength),
          deviceTitle = controller.config.title;

      console.log('\x1b[35m' + deviceTitle + '\x1b[0m: DVR started');

      this.dvrProcess = spawn(dvrCommand.command, dvrCommand.params);

      this.dvrProcess.stderr.on('data', function (data) {
        data = data.toString();

        // If you need help debugging ffmpeg, uncomment the following line:
        // console.log(data)
      });

      this.dvrProcess.once('close', function () {
        console.log('\x1b[35m' + deviceTitle + '\x1b[0m: DVR stopped');
      });
    },

    stopDvr : function (controller) {
      var now = new Date().getTime();

      if (this.dvrProcess) {
        this.dvrProcess.kill();
        this.dvrProcess = null;

        // When recording is over, we can safely build out any remaining
        // thumbnails.
        this.checkThumbnails(controller, 0);
        this.lastEvents.thumbnail = now;
      }
    },

    foscamDvr : function (device, command, controllers, values, config) {
      var deviceState    = require(__dirname + '/../lib/deviceState'),
          controller     = controllers[device],
          currentState   = deviceState.getDeviceState(device),
          now            = new Date().getTime(),
          delay          = (config.delay || 300) * 1000,
          videoLength    = config.videoLength || 600,
          bytePerMeg     = 1048576,
          roughMbPerMin  = 15,
          // Maximum MB limit for all stored videos before we start deleting
          // old files till we fall below that threshold.
          byteLimit      = (config.byteLimit || 5120) * bytePerMeg,
          // Minimum MB limit for a video file before we bother building a
          // thumbnail set for it.  Any files that are smaller than this size
          // will have thumbnails generated when recordig has ended.
          thumbByteLimit = (config.thumbByteLimit || (roughMbPerMin * (videoLength / 60))) * bytePerMeg;

      if ((currentState) && (currentState.value)) {
        if ((currentState.value === 'off') && (this.dvrProcess)) {
          this.stopDvr(controller);
        }

        else if ((currentState.value === 'on') && (!this.dvrProcess)) {
          this.startDvr(controller, videoLength);
        }
      }

      // Only care about disc space when something will be written.
      if (this.dvrProcess) {
        // Only check the disc usage after a delay (default 5 minutes) since it
        // may be expensive.
        if (now > (this.lastEvents.space + delay)) {
          this.checkDisc(controller, byteLimit);
          this.lastEvents.space = now;
        }

        if (now > (this.lastEvents.thumbnail + delay)) {
          this.checkThumbnails(controller, thumbByteLimit);
          this.lastEvents.thumbnail = now;
        }
      }
    }
  };
}());
