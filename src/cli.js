import taskz from "taskz";
import fs from "fs";
import path from "path";
import rimraf from "rimraf";
import cheerio from "cheerio";
import cleanHtml from 'clean-html';
import expressions from "angular-expressions";
import chalk from "chalk";

export async function cli(args) {
    const options = {
        autoRemoveOutputDir: true,
        showWarnings: true,
        beautify: true,
        outputDir: "build",
    }
    if (fs.existsSync(options.outputDir) && options.autoRemoveOutputDir) {
        rimraf.sync(options.outputDir);
    }
    fs.mkdirSync(options.outputDir);
    taskz([
        {
            text: "Finding files",
            task: (ctx) => {
                const files = fs.readdirSync(".");
                ctx.files = files.filter((f) => f.endsWith(".html"));
                ctx.configs = files.filter((f) => f.endsWith(".json"));
            },
        },
        {
            text: "Reading configs",
            task: (ctx) => {
                ctx.data = {};
                for (const config of ctx.configs) {
                    ctx.data[path.basename(config, path.extname(config))] = JSON.parse(fs.readFileSync(config));
                }
                ctx.configs = undefined;
            },
        },
        {
            text: "Rendering files",
            task: async (ctx) => {
                try {
                    //console.log(ctx);
                    for (const file of ctx.files) {
                        ctx.text(`Rendering file ${file}`);
                        const $ = cheerio.load(fs.readFileSync(file), {
                            lowerCaseAttributeNames: true,
                        });
                        renderCases($, ctx, options);
                        renderLoops($, ctx);
                        let content = $.html();
                        if (options.beautify) {
                            content = await new Promise((resolve, reject) => {
                                cleanHtml.clean(content, {
                                    "break-around-tags": ["li", "meta", "title"],
                                    "indent": "    ",
                                },
                                    (result) => {
                                        resolve(result);
                                    });
                            });
                        }
                        fs.writeFileSync(path.join(options.outputDir, file), content);
                    }
                    ctx.text("Rendering files finished");
                } catch (err) {
                    console.log(err, err.stack);
                }
            }
        }
    ]).run();
}

function renderLoops($, ctx) {
    const loops = $("[\\*ngfor]");
    loops.each((index, element) => {
        let forWhat = $(element).attr()["*ngfor"];
        forWhat = forWhat.replace(/\s\s+/g, ' ');
        forWhat.replace("let ", "");
        forWhat.replace("const ", "");
        forWhat = forWhat.split(" of ");
        let name = forWhat[0];
        if (name.startsWith("let ")) {
            name = name.slice("4");
        }
        else if (name.startsWith("const ")) {
            name = name.slice("6");
        }
        name = name.trim();
        const configName = forWhat[1].trim();
        $(element).removeAttr("*ngfor");
        //const originalElement = $(element);
        let mainObject = configName.substr(0, configName.indexOf('.'));
        const deep = configName.replace(`${mainObject}.`, "");
        for (const value of (mainObject ? findDeep(ctx.data[mainObject], deep) : ctx.data[configName])) {
            const originalText = $(element).text();
            const data = { [name]: value };
            let text = $(element).text();
            let foundExpressions = [];
            const rxp = /{{([^}]+)}}/g;
            let curMatch;
            while (curMatch = rxp.exec(text)) {
                foundExpressions.push([curMatch[0], curMatch[1]]);
            }
            for (const exp of foundExpressions) {
                //console.log(data);
                const result = expressions.compile(exp[1])(data);
                text = text.replace(exp[0], result);
            }
            $(element).text(text);
            $(element.parent).append($.html(element));
            $(element).text(originalText);
        }
        $(element).remove();
    });
}

function renderCases($, ctx, options) {
    const cases = $("[\\*ngif]");
    cases.each((index, element) => {
        let exp = $(element).attr()["*ngif"];
        const result = expressions.compile(exp)(ctx.data);
        if (result === undefined && options.showWarnings) {
            console.log(`${chalk.yellow("‼")} ${chalk.grey("Warning:")} the expression '${exp}' is undefined!`);
        }
        if (result) {
            $(element).removeAttr("*ngif");
        } else {
            $(element).remove();
        }
    });
}

function findDeep(o, s) {
    s = s.replace(/\[(\w+)\]/g, '.$1');
    s = s.replace(/^\./, '');
    var a = s.split('.');
    for (var i = 0, n = a.length; i < n; ++i) {
        var k = a[i];
        if (k in o) {
            o = o[k];
        } else {
            return;
        }
    }
    return o;
}
