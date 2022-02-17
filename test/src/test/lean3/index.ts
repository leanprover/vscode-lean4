import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';

export function run(testsRoot: string, cb: (error: any, failures?: number) => void): void {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd'
	});

	console.log('>>>>>>>>> testsRoot=' + testsRoot);

	glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
		if (err) {
			return cb(err);
		}

		// Add files to the test suite
		files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

		try {
			// Run the mocha test
			mocha.timeout(60000); // 60 seconds to run
			mocha.run(failures => {
				cb(null, failures);
			});
		} catch (err) {
			console.error(err);
			cb(err);
		}
	});
}
