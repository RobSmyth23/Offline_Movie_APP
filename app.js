// Movie Extravaganza
// Local movie storage, the movie list controls, and CouchDB syncing.

const LOCAL_DB_NAME = "movie_extravaganza_local";
const REMOTE_DB_URL = "http://127.0.0.1:5984/movies_a";
const MOVIES_PER_PAGE = 10;

const localDB = new PouchDB(LOCAL_DB_NAME);

let remoteDB;
let syncHandler;
let syncing = false;

// These two values remember the current list view.
let selectedLetter = "All";
let currentPage = 1;

// Get the page elements once so the functions below can update them.
const form = document.getElementById("movie-form");
const titleInput = document.getElementById("title");
const yearInput = document.getElementById("year");
const genresInput = document.getElementById("genres");
const actorsInput = document.getElementById("actors");
const movieList = document.getElementById("movie-list");
const connectionStatus = document.getElementById("connection-status");
const syncStatus = document.getElementById("sync-status");
const movieFilters = document.getElementById("movie-filters");
const movieCount = document.getElementById("movie-count");
const previousPageButton = document.getElementById("previous-page");
const nextPageButton = document.getElementById("next-page");
const pageIndicator = document.getElementById("page-indicator");

// Keep the connection and sync messages in one place.
function setConnection(message) {
    connectionStatus.textContent = message;
}

function setSync(message) {
    syncStatus.textContent = message;
}

// Turn comma-separated actor and genre input into clean arrays.
function splitList(value) {
    return value.split(",").map(item => item.trim()).filter(Boolean);
}

// Build the All, A-Z and Other buttons. Rebuilding the buttons also
// updates which one is highlighted after the user selects a filter.
function renderAlphabetFilters() {
    movieFilters.replaceChildren();

    const letters = ["All", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "Other"];

    for (const letter of letters) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "filter-button";
        button.textContent = letter;

        if (letter === selectedLetter) {
            button.classList.add("active-filter");
            button.setAttribute("aria-pressed", "true");
        } else {
            button.setAttribute("aria-pressed", "false");
        }

        button.addEventListener("click", () => {
            selectedLetter = letter;
            currentPage = 1; // Start at the first page for each new filter.
            showMovies();
        });

        movieFilters.appendChild(button);
    }
}

// Decide whether a title belongs under the selected letter.
// Other catches titles that do not start with an English letter A-Z.
function matchesSelectedLetter(movie) {
    if (selectedLetter === "All") {
        return true;
    }

    const firstCharacter = (movie.title || "").trim().charAt(0);

    if (selectedLetter === "Other") {
        return !/^[A-Za-z]$/.test(firstCharacter);
    }

    return firstCharacter.toUpperCase() === selectedLetter;
}

// Load the local database, sort and filter its movies, and draw the
// current page. The list reads from PouchDB so it can still work offline.
async function showMovies() {
    try {
        const result = await localDB.allDocs({
            include_docs: true,
            conflicts: true
        });

        const allMovies = result.rows
            .map(row => row.doc)
            .filter(doc => doc && !doc._deleted)
            .sort((a, b) =>
                (a.title || "").localeCompare(b.title || "")
            );

        // Filter first, then calculate which ten movies belong on this page.
        const filteredMovies = allMovies.filter(matchesSelectedLetter);
        const totalPages = Math.max(
            1,
            Math.ceil(filteredMovies.length / MOVIES_PER_PAGE)
        );

        // If a delete leaves us on a page that no longer exists, move back.
        currentPage = Math.min(currentPage, totalPages);

        const startIndex = (currentPage - 1) * MOVIES_PER_PAGE;
        const visibleMovies = filteredMovies.slice(
            startIndex,
            startIndex + MOVIES_PER_PAGE
        );

        renderAlphabetFilters();
        movieList.replaceChildren();

        if (filteredMovies.length === 0) {
            movieList.textContent = selectedLetter === "All"
                ? "No movies yet. Add your first movie!"
                : `No movies beginning with "${selectedLetter}".`;
        } else {
            for (const movie of visibleMovies) {
                const card = document.createElement("div");
                card.className = "movie-card";

                const heading = document.createElement("h3");
                heading.textContent = movie.title || "Untitled movie";
                card.appendChild(heading);

                const details = document.createElement("p");
                details.textContent =
                    "Year: " + (movie.year ?? "Not specified") +
                    " | Genres: " + (movie.genres || []).join(", ") +
                    " | Actors: " + (movie.actors || []).join(", ");
                card.appendChild(details);

                // PouchDB can report competing revisions for a document.
                if (movie._conflicts && movie._conflicts.length > 0) {
                    const warning = document.createElement("p");
                    warning.textContent =
                        "Conflict detected: competing revisions exist.";
                    warning.style.color = "#ffe45c";
                    card.appendChild(warning);
                }

                const editButton = document.createElement("button");
                editButton.textContent = "Edit";
                editButton.addEventListener("click", () => editMovie(movie));
                card.appendChild(editButton);

                const deleteButton = document.createElement("button");
                deleteButton.textContent = "Delete";
                deleteButton.className = "delete-button";
                deleteButton.addEventListener("click", () => deleteMovie(movie));
                card.appendChild(deleteButton);

                movieList.appendChild(card);
            }
        }

        // Use a normal hyphen here to avoid odd dash characters in the display.
        const firstShown = filteredMovies.length === 0 ? 0 : startIndex + 1;
        const lastShown = Math.min(
            startIndex + MOVIES_PER_PAGE,
            filteredMovies.length
        );

        movieCount.textContent =
            `Showing ${firstShown}-${lastShown}` +
            ` of ${filteredMovies.length} movie(s)` +
            (selectedLetter === "All" ? "" : ` - Filter: ${selectedLetter}`);

        pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
        previousPageButton.disabled = currentPage <= 1;
        nextPageButton.disabled = currentPage >= totalPages;
    } catch (error) {
        console.error("Could not display movies:", error);
        movieList.textContent = "Could not load movies. Please try again.";
    }
}

// The arrows change the page number and redraw the visible movies.
previousPageButton.addEventListener("click", () => {
    if (currentPage > 1) {
        currentPage--;
        showMovies();
    }
});

nextPageButton.addEventListener("click", async () => {
    currentPage++;
    await showMovies();
});

// Add a new movie to the local database. Sync sends it to CouchDB when
// a connection is available; saving locally does not require the server.
form.addEventListener("submit", async event => {
    event.preventDefault();

    const title = titleInput.value.trim();

    if (!title) {
        alert("Please enter a movie title.");
        return;
    }

    const movie = {
        _id: new Date().toISOString() + "-" +
            Math.random().toString(16).slice(2),
        title,
        year: yearInput.value ? Number(yearInput.value) : null,
        genres: splitList(genresInput.value),
        actors: splitList(actorsInput.value),
        createdAt: new Date().toISOString()
    };

    try {
        await localDB.put(movie);
        form.reset();
        selectedLetter = "All";
        currentPage = 1;
        setSync("Changes Pending Sync");
        await showMovies();
    } catch (error) {
        console.error("Could not add movie:", error);
        alert("The movie could not be saved. Check the browser console.");
    }
});

// Edit the selected movie. Keeping its _id and _rev lets PouchDB update
// the existing document instead of creating a second movie.
async function editMovie(movie) {
    const title = prompt("Movie title:", movie.title || "");
    if (title === null) return;

    const year = prompt(
        "Release year:",
        movie.year === null || movie.year === undefined ? "" : movie.year
    );
    if (year === null) return;

    const genres = prompt(
        "Genres (separate with commas):",
        (movie.genres || []).join(", ")
    );
    if (genres === null) return;

    const actors = prompt(
        "Actors (separate with commas):",
        (movie.actors || []).join(", ")
    );
    if (actors === null) return;

    if (!title.trim()) {
        alert("The movie title cannot be empty.");
        return;
    }

    const updatedMovie = {
        ...movie,
        title: title.trim(),
        year: year.trim() ? Number(year) : null,
        genres: splitList(genres),
        actors: splitList(actors),
        updatedAt: new Date().toISOString()
    };

    try {
        await localDB.put(updatedMovie);
        setSync("Changes Pending Sync");
        await showMovies();
    } catch (error) {
        console.error("Could not update movie:", error);
        alert("The movie could not be updated. Check the browser console.");
    }
}

// PouchDB uses a tombstone when deleting a document so that the deletion
// can also be passed to the remote database during replication.
async function deleteMovie(movie) {
    const confirmed = confirm(`Delete "${movie.title}"?`);
    if (!confirmed) return;

    try {
        await localDB.remove(movie);
        setSync("Changes Pending Sync");
        await showMovies();
    } catch (error) {
        console.error("Could not delete movie:", error);
        alert("The movie could not be deleted. Check the browser console.");
    }
}

// Attach listeners to a live replication handler so the status on the page
// reflects whether changes are being sent or received.
function attachSyncListeners(handler) {
    handler
        .on("change", info => {
            console.log("Sync change:", info);
            setSync("Syncing Changes...");
            showMovies();
        })
        .on("paused", error => {
            if (error) {
                console.warn("Sync paused:", error);
                setConnection("CouchDB Connection Interrupted");
                setSync("Changes Pending Sync");
            } else {
                setConnection("CouchDB Connected");
                setSync("All Changes Synced");
            }
        })
        .on("active", () => {
            setConnection("CouchDB Connected");
            setSync("Syncing Changes...");
        })
        .on("denied", error => {
            console.error("Sync denied:", error);
            setSync("Sync Denied - Check Permissions");
        })
        .on("error", error => {
            console.error("Sync error:", error);
            setConnection("CouchDB Connection Error");
            setSync("Changes Pending Sync");
        });
}

// Open the remote database with the login details and start live sync.
async function connectAndSync(username, password) {
    remoteDB = new PouchDB(REMOTE_DB_URL, {
        auth: { username, password }
    });

    await remoteDB.info();

    if (syncHandler) syncHandler.cancel();

    syncHandler = localDB.sync(remoteDB, {
        live: true,
        retry: true
    });

    attachSyncListeners(syncHandler);
    setConnection("CouchDB Connected");
}

// Get the login details without saving the password in this source file.
async function startConnection() {
    const username = prompt("CouchDB username:");
    if (username === null || !username.trim()) {
        setConnection("CouchDB Not Connected");
        return;
    }

    const password = prompt("CouchDB password:");
    if (password === null) {
        setConnection("CouchDB Not Connected");
        return;
    }

    try {
        await connectAndSync(username.trim(), password);
    } catch (error) {
        console.error("Connection failed:", error);
        setConnection("CouchDB Connection Error");
        setSync("Changes Pending Sync");
        alert("Could not connect. Check your credentials and browser console.");
    }
}

// If the browser comes back online, check CouchDB and restart live sync.
window.addEventListener("online", async () => {
    if (!remoteDB || syncing) return;

    try {
        syncing = true;

        if (syncHandler) syncHandler.cancel();
        syncHandler = null;

        const info = await remoteDB.info();
        console.log("CouchDB available:", info.db_name);

        syncHandler = localDB.sync(remoteDB, {
            live: true,
            retry: true
        });

        attachSyncListeners(syncHandler);
    } catch (error) {
        console.error("Reconnect failed:", error);
        setConnection("CouchDB Connection Error");
        setSync("Changes Pending Sync");
    } finally {
        syncing = false;
    }
});

// Show a local-mode message if the browser loses its network connection.
window.addEventListener("offline", () => {
    setConnection("Offline - Local Mode");
    setSync("Changes Pending Sync");
});

// Refresh the list when a local database change is detected.
localDB.changes({
    since: "now",
    live: true
}).on("change", showMovies);

// Load saved movies first, then connect to CouchDB if the browser is online.
async function initialise() {
    await showMovies();

    if (!navigator.onLine) {
        setConnection("Offline - Local Mode");
        setSync("Changes Pending Sync");
    } else {
        await startConnection();
    }
}

initialise();