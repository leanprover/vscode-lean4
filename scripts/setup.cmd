pushd %~dp0..
call npm install
call npx lerna bootstrap
call npm run build
