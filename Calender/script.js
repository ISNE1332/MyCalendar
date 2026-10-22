
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const firebaseConfig = {
  apiKey: "AIzaSyCa1oRkisAN95uvP-NrUyK2xsSffjlQuew",
  authDomain: "mycalendar-88a50.firebaseapp.com",
  projectId: "mycalendar-88a50",
  storageBucket: "mycalendar-88a50.firebasestorage.app",
  messagingSenderId: "25774593137",
  appId: "1:25774593137:web:4a8e7c16b6637fcd4a37d0"
};

// Initialize Firebase and get a handle to the Firestore database
const firebaseApp = initializeApp(firebaseConfig);
const db  = getFirestore(firebaseApp);

// Reference to the "appointments" collection (like a table in a database)
const col = collection(db, "appointments");

// Run everything once the page (DOM) is ready.
// The callback is async because we use await for Firestore calls.
$(document).ready(async function () {

  // -- Application state --
  let appointments = [];   // local copy of all appointments loaded from Firestore
  let viewYear, viewMonth; // the month currently displayed (viewMonth is 0-11)

  // Helper: pad a number to 2 digits, e.g. 5 -> "05" (used for ISO dates)
  const pad = n => String(n).padStart(2, "0");

  // -- Form template --
  // HTML for the "new appointment" form. Each .error div is hidden by CSS
  // and only shown when its parent .field gets the "invalid" class.
  const formHtml = `
    <form id="appt-form">
      <div class="field">
        <label for="title">Title</label>
        <input id="title" type="text">
        <div class="error">Please enter a title.</div>
      </div>
      <div class="field">
        <label for="date">Date</label>
        <input id="date" type="date">
        <div class="error">Please choose a date.</div>
      </div>
      <div class="field">
        <label for="time">Time</label>
        <input id="time" type="time">
        <div class="error">Please choose a time.</div>
      </div>
      <div class="field">
        <label for="desc">Description</label>
        <textarea id="desc" rows="3"></textarea>
        <div class="error">Please enter a description.</div>
      </div>
      <button type="submit">Save appointment</button>
    </form>`;

  // Replace the content of #app with the empty form
  function showForm() {
    $("#app").empty().append(formHtml);
  }

  // Open a modal dialog (jQuery UI) showing the details of one appointment
  function showDetail(a) {
    $("#detail").remove(); // remove any previous dialog element
    const $d = $('<div id="detail"></div>').attr("title", a.title); // title becomes the dialog title

    // XSS protection: use .text() to set the text content, not .html()
    $d.append($("<p></p>").text("Date: " + a.date));
    $d.append($("<p></p>").text("Time: " + a.time));
    $d.append($("<p></p>").css("white-space", "pre-wrap").text(a.desc)); // keep line breaks in the description

    $d.dialog({
      modal: true,
      width: 380,
      // Clean up the dialog from the DOM when it is closed
      close: function () { $(this).dialog("destroy").remove(); }
    });
  }

  // -- Calendar rendering --
  // Rebuilds the whole calendar view for the current viewYear / viewMonth
  function showCalendar() {
    $("#app").empty();

    // First day of the month and a readable title like "October 2026"
    const first = new Date(viewYear, viewMonth, 1);
    const title = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    // Header: previous / next month buttons, title, and "+ New" button
    $("#app").append(`
      <div class="cal-head">
        <button type="button" id="prev">&lt;</button>
        <h2>${title}</h2>
        <button type="button" id="next">&gt;</button>
        <button type="button" id="new">+ New</button>
      </div>`);

    // Grid container (7 columns, defined in CSS) with the day-of-week header row
    const $grid = $('<div class="grid"></div>');
    ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach(function (n) {
      $grid.append(`<div class="dow">${n}</div>`);
    });

    // The grid always shows 6 weeks (42 cells). It starts on the Sunday on or before
    // the 1st of the month, so days from the previous/next month fill the gaps.
    const start = new Date(viewYear, viewMonth, 1 - first.getDay());
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);

      // ISO date string "YYYY-MM-DD" - same format as <input type="date"> and stored in Firestore
      const dIso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      // One day cell. data-date lets the drop handler know which date it represents.
      // Days outside the current month get the "other" class (greyed out).
      const $cell = $('<div class="day"></div>')
        .attr("data-date", dIso)
        .toggleClass("other", d.getMonth() !== viewMonth)
        .append(`<span class="num">${d.getDate()}</span>`);

      // Add the appointments that fall on this date, sorted by time
      appointments
        .filter(function (a) { return a.date === dIso; })
        .sort(function (a, b) { return a.time.localeCompare(b.time); })
        .forEach(function (a) {
          $cell.append(
            $('<div class="appt"></div>')
              .attr("data-id", a.id)      // Firestore document id
              .attr("title", a.desc)      // tooltip shows the description on hover
              .append($("<span></span>").text(a.time + " " + a.title))
              .append('<span class="x" title="Delete">✕</span>') // delete button
          );
        });

      $grid.append($cell);
    }
    $("#app").append($grid);

    // Month navigation and "new appointment" buttons
    $("#prev").on("click", function () { shiftMonth(-1); });
    $("#next").on("click", function () { shiftMonth(1); });
    $("#new").on("click", showForm);

    // Delete an appointment: remove it from Firestore, then from the local array, then redraw
    $(".x").on("click", async function () {
      const id = String($(this).parent().attr("data-id"));
      await deleteDoc(doc(db, "appointments", id));
      appointments = appointments.filter(function (a) { return String(a.id) !== id; });
      showCalendar();
    });

    // Make appointments draggable (jQuery UI).
    // helper "clone" drags a copy; revert "invalid" snaps it back if dropped outside a day cell.
    $(".appt").draggable({
      helper: "clone",
      appendTo: "body",
      revert: "invalid",
      cursor: "grabbing"
    });

    // Click an appointment to open its detail dialog
    $(".appt").on("click", function (e) {
      // Clicking the ✕ is a delete action
      if ($(e.target).hasClass("x")) return;
      const id = String($(this).attr("data-id"));
      const a = appointments.find(function (x) { return String(x.id) === id; });
      if (a) showDetail(a);
    });

    // Make each day cell a drop target (jQuery UI)
    $(".day").droppable({
      accept: ".appt",
      tolerance: "pointer", // the cell under the mouse pointer is the target
      over: function () { $(this).addClass("over"); },   // highlight while hovering
      out:  function () { $(this).removeClass("over"); },// remove highlight on leaving
      drop: async function (event, ui) {
        $(this).removeClass("over");

        const id      = String(ui.draggable.attr("data-id")); // which appointment was dragged
        const newDate = $(this).attr("data-date");            // which day it was dropped on

        // Update the local copy first, then save the new date to Firestore
        appointments.forEach(function (a) {
          if (String(a.id) === id) a.date = newDate;
        });
        await updateDoc(doc(db, "appointments", id), { date: newDate });
        showCalendar(); // redraw so the appointment appears in its new cell
      }
    });
  }

  // Move the view forward/backward by `delta` months (e.g. -1 = previous month).
  // The Date constructor handles year rollover automatically (month 12 -> January next year).
  function shiftMonth(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    viewYear  = d.getFullYear();
    viewMonth = d.getMonth();
    showCalendar();
  }

  // -- Create a new appointment --
  // Event delegation: the form is created dynamically, so we listen on #app
  // and only react to submits coming from #appt-form.
  $("#app").on("submit", "#appt-form", async function (e) {
    e.preventDefault(); // stop the browser's default form submit (page reload)
    let ok = true;

    // Validation: every field must be non-empty.
    // Toggle the "invalid" class on the parent .field to show/hide the red error style.
    $(this).find("input, textarea").each(function () {
      const empty = $(this).val().trim() === "";
      $(this).parent().toggleClass("invalid", empty);
      if (empty) ok = false;
    });

    if (ok) {
      // Build the appointment object from the form values
      const appt = {
        title: $("#title").val().trim(),
        date:  $("#date").val(),   // "YYYY-MM-DD"
        time:  $("#time").val(),   // "HH:MM"
        desc:  $("#desc").val().trim()
      };

      // Save to Firestore; it returns a reference containing the auto-generated id
      const ref = await addDoc(col, appt);
      appt.id = ref.id;
      appointments.push(appt);

      // Jump the calendar to the month of the new appointment so the user sees it
      const parts = appt.date.split("-");
      viewYear  = Number(parts[0]);
      viewMonth = Number(parts[1]) - 1; // Date months are 0-based

      $(this).remove();
      showCalendar();
    }
  });

  // Start by showing the current month
  const now = new Date();
  viewYear  = now.getFullYear();
  viewMonth = now.getMonth();

  // Load all appointments from Firestore and merge the document id into each object
  const snap = await getDocs(col);
  appointments = snap.docs.map(function (d) {
    return { id: d.id, ...d.data() };
  });

  // If there are saved appointments show the calendar, otherwise show the empty form
  if (appointments.length > 0) showCalendar(); else showForm();
});