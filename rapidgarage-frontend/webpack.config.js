// Load .env (if present) so GOOGLE_MAPS_API_KEY can be set without committing it.
const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

function readEnvFile() {
  const file = path.join(__dirname, '.env');
  const out = {};
  if (!fs.existsSync(file)) return out;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
  return out;
}
const fileEnv = readEnvFile();
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || fileEnv.GOOGLE_MAPS_API_KEY || '';

module.exports = {
  plugins: [
    // The browser key is public by nature; protect it with HTTP-referrer and
    // API restrictions in Google Cloud Console rather than secrecy.
    new webpack.DefinePlugin({ GOOGLE_MAPS_API_KEY: JSON.stringify(GOOGLE_MAPS_API_KEY) }),
  ],
  entry: './app/index.js',
  output: {
    filename: 'bundle.js'
  },
  devServer: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        pathRewrite: {"^/api" : ""}
      }
    }
  },
  module: {
    loaders: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        loader: 'babel-loader'
      },
      {
        test: /\.(png|jpg)$/,
        loader: 'url?limit=25000'
      }
    ]
  }
};
